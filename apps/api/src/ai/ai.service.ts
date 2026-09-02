import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ActorType, type Principal } from '@notesetc/shared';
import type { AuditContext } from '../audit/audit.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AutomationsService } from '../automations/automations.service';
import { NETC_API_DOCS } from '../automations/netc-api-docs';
import { PagesService } from '../pages/pages.service';
import { SearchService } from '../search/search.service';
import { SpacesService } from '../spaces/spaces.service';
import { AiChatsService, type StoredChatMessage } from './ai-chats.service';
import { AiMemoryService } from './ai-memory.service';
import { AiSettingsService } from './ai-settings.service';
import {
  type AiProviderConfig,
  type ModelOption,
  type ModelReply,
  type ToolCall,
  type ToolDef,
  type Turn,
  callModel,
  estimateUsd,
  listModels,
} from './providers';

const MAX_TOOL_ROUNDS = 12;
const TOOL_RESULT_CAP = 24_000; // chars fed back to the model per tool call
const CONTENT_TOKEN_CAP = 50_000; // refuse doc-content inclusion beyond this

export interface ToolTraceEntry {
  tool: string;
  summary: string;
}

export interface ChatReply {
  reply: string;
  trace: ToolTraceEntry[];
}

export interface FilingSuggestion {
  pageId: string;
  pageTitle: string;
  summary: string | null;
  rationale: string;
  appendMarkdown: string;
  trace: ToolTraceEntry[];
}

/** The wiki tools the model may call. Every call runs under the USER's principal. */
const TOOLS: ToolDef[] = [
  {
    name: 'search_pages',
    description: 'Full-text search across wiki pages. Returns matches with page ids and snippets.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search terms.' } },
      required: ['query'],
    },
  },
  {
    name: 'list_spaces',
    description: 'List the workspaces (spaces) with their ids and names.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_pages',
    description: 'List all pages in a space: id, title, parentId — useful to see the page tree.',
    parameters: {
      type: 'object',
      properties: { spaceId: { type: 'string' } },
      required: ['spaceId'],
    },
  },
  {
    name: 'get_page',
    description: 'Read a page: title and full Markdown content.',
    parameters: {
      type: 'object',
      properties: { pageId: { type: 'string' } },
      required: ['pageId'],
    },
  },
  {
    name: 'list_attachments',
    description: 'List document attachments in a space (optionally only those linked to one page).',
    parameters: {
      type: 'object',
      properties: { spaceId: { type: 'string' }, pageId: { type: 'string' } },
      required: ['spaceId'],
    },
  },
  {
    name: 'create_page',
    description:
      'Create a new page (NEFM Markdown content). It starts as a DRAFT — call publish_page to make it visible. Requires editor access to the space.',
    parameters: {
      type: 'object',
      properties: {
        spaceId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown body.' },
        parentId: { type: 'string', description: 'Optional parent page id to nest under.' },
      },
      required: ['spaceId', 'title'],
    },
  },
  {
    name: 'update_page',
    description:
      'Replace a page\'s content and/or title. ALWAYS get_page first and send the complete new Markdown — this overwrites the whole body. Preserve everything the user did not ask you to change.',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        content: { type: 'string', description: 'The complete new Markdown body.' },
        title: { type: 'string' },
        changeSummary: { type: 'string', description: 'One line describing the change.' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'publish_page',
    description: 'Publish a draft page so viewers can see it.',
    parameters: {
      type: 'object',
      properties: { pageId: { type: 'string' } },
      required: ['pageId'],
    },
  },
  {
    name: 'automation_docs',
    description:
      'The full reference for the netc.* automation scripting API, trigger config shapes and mock mode. Read this BEFORE creating or editing an automation.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_automations',
    description: 'List automations: id, name, trigger, enabled state.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_automation',
    description: 'Fetch one automation including its script and trigger config.',
    parameters: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
      required: ['automationId'],
    },
  },
  {
    name: 'create_automation',
    description:
      'Create a JavaScript automation (created DISABLED; test with test_automation, then enable via update_automation). Read automation_docs first. Triggers: page_event {events[, spaceIds]}, schedule {cron[, timezone]}, webhook {}.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        triggerType: { type: 'string', enum: ['page_event', 'schedule', 'webhook'] },
        triggerConfig: { type: 'object', description: 'Shape depends on triggerType — see automation_docs.' },
        script: { type: 'string', description: 'JavaScript body; top-level await allowed.' },
        timeoutMs: { type: 'number' },
        debugMode: { type: 'boolean' },
        webhookSlug: { type: 'string' },
      },
      required: ['name', 'triggerType', 'triggerConfig', 'script'],
    },
  },
  {
    name: 'update_automation',
    description: 'Update an automation (script, trigger config, timeout, debugMode) and/or toggle {enabled}. Trigger TYPE cannot change.',
    parameters: {
      type: 'object',
      properties: {
        automationId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        enabled: { type: 'boolean' },
        triggerConfig: { type: 'object' },
        script: { type: 'string' },
        timeoutMs: { type: 'number' },
        debugMode: { type: 'boolean' },
      },
      required: ['automationId'],
    },
  },
  {
    name: 'test_automation',
    description:
      'Run an automation now and wait for the result (status + logs). mockMode=true (default) is a safe dry-run: reads real, writes logged but NOT applied. Works while disabled — the dev loop is create, test, fix, enable.',
    parameters: {
      type: 'object',
      properties: {
        automationId: { type: 'string' },
        mockMode: { type: 'boolean', description: 'Default true (dry-run).' },
        simulatedEvent: { type: 'object', description: 'Optional fake netc.trigger fields.' },
        waitSeconds: { type: 'number' },
      },
      required: ['automationId'],
    },
  },
  {
    name: 'get_automation_run',
    description: 'Fetch one automation run with status and logs.',
    parameters: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
    },
  },
  {
    name: 'list_automation_variables',
    description: 'List variables scripts read via netc.variable(name). Omit automationId for globals. Secure values are never returned.',
    parameters: {
      type: 'object',
      properties: { automationId: { type: 'string' } },
    },
  },
  {
    name: 'set_automation_variable',
    description: 'Create or update a variable for netc.variable(name). Prefer script-scoped (pass automationId). isSecure=true for keys/passwords: encrypted, write-only.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'string' },
        isSecure: { type: 'boolean' },
        automationId: { type: 'string' },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'update_memory',
    description:
      'Save or remove durable facts about the user in your long-term memory (shown to you at the start of every chat). Use it the moment you learn a lasting preference or fact — preferred shops, home town, family details, sizes, dietary rules. Keys are short snake_case, values short plain text. Do NOT store secrets, one-off context, or anything already in memory.',
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: 'Facts to save or overwrite, e.g. {"preferred_hardware_store": "Bunnings"}.',
          additionalProperties: { type: 'string' },
        },
        remove: {
          type: 'array',
          description: 'Keys to delete because they are wrong or obsolete.',
          items: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'get_attachment_text',
    description: 'Extracted text of an attachment (pdf/docx/xlsx/txt/csv) — e.g. to read a manual.',
    parameters: {
      type: 'object',
      properties: { attachmentId: { type: 'string' } },
      required: ['attachmentId'],
    },
  },
];

function clip(s: string, cap = TOOL_RESULT_CAP): string {
  return s.length > cap ? s.slice(0, cap) + `\n…[truncated at ${cap} chars]` : s;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly settings: AiSettingsService,
    private readonly chats: AiChatsService,
    private readonly memory: AiMemoryService,
    private readonly spaces: SpacesService,
    private readonly pages: PagesService,
    private readonly search: SearchService,
    private readonly attachments: AttachmentsService,
    private readonly automations: AutomationsService,
  ) {}

  async status(): Promise<{ enabled: boolean; provider?: string; model?: string }> {
    const cfg = await this.settings.getConfig();
    if (!cfg?.enabled) return { enabled: false };
    return { enabled: true, provider: cfg.provider, model: cfg.model };
  }

  private async requireConfig(): Promise<AiProviderConfig & { webSearch?: boolean }> {
    const cfg = await this.settings.getProviderConfig();
    if (!cfg?.enabled) throw new ServiceUnavailableException('The AI agent is not enabled.');
    return cfg;
  }

  /**
   * Admin "Test" button: checks connectivity AND that the model can call
   * tools — the agent is useless without tool support, and that is exactly
   * the failure a plain ping cannot see. Tests the DRAFT config when one is
   * passed (so no save is needed first); the stored key fills in when the
   * draft has none and the provider matches.
   */
  async testConnection(draft?: {
    provider: AiProviderConfig['provider'];
    model: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<{ ok: boolean; toolsOk?: boolean; reply?: string; error?: string }> {
    let cfg: AiProviderConfig | null;
    if (draft) {
      let apiKey = draft.apiKey;
      if (!apiKey) {
        const stored = await this.settings.getProviderConfig();
        if (stored && stored.provider === draft.provider) apiKey = stored.apiKey;
      }
      cfg = { provider: draft.provider, model: draft.model, baseUrl: draft.baseUrl || undefined, apiKey };
    } else {
      cfg = await this.settings.getProviderConfig();
    }
    if (!cfg?.model) return { ok: false, error: 'Not configured yet.' };
    try {
      const r = await callModel(cfg, 'You are a connectivity test. Reply with the single word: ok', [
        { role: 'user', text: 'ping' },
      ], []);
      let toolsOk = false;
      try {
        const t = await callModel(
          cfg,
          'You are a tool-calling test. You MUST call the ping tool. Do not answer in text.',
          [{ role: 'user', text: 'Call the ping tool now.' }],
          [{
            name: 'ping',
            description: 'Connectivity test tool. Call it with ok=true.',
            parameters: { type: 'object', properties: { ok: { type: 'boolean' } } },
          }],
        );
        toolsOk = !!t.calls?.length;
      } catch {
        toolsOk = false;
      }
      return { ok: true, toolsOk, reply: (r.text ?? '').slice(0, 80) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Models the admin can pick for a provider, filtered to tool-capable chat
   * models where the provider tells us (Ollama capabilities, Gemini generation
   * methods) and by family where it does not (OpenAI, Anthropic). Uses the
   * pasted key when given, else the stored one.
   */
  async listAvailableModels(input: {
    provider: AiProviderConfig['provider'];
    baseUrl?: string;
    apiKey?: string;
  }): Promise<ModelOption[]> {
    let apiKey = input.apiKey;
    if (!apiKey) {
      const stored = await this.settings.getProviderConfig();
      if (stored && stored.provider === input.provider) apiKey = stored.apiKey;
    }
    return listModels({ provider: input.provider, model: '', baseUrl: input.baseUrl || undefined, apiKey });
  }

  /** Execute one tool call under the caller's principal; errors become model-visible text. */
  private async runTool(
    principal: Principal,
    ctx: AuditContext,
    call: ToolCall,
    trace: ToolTraceEntry[],
    meta?: { chatId?: string },
  ): Promise<string> {
    const a = call.args;
    try {
      switch (call.name) {
        case 'search_pages': {
          const rows = await this.search.query(principal, String(a.query ?? ''), undefined);
          trace.push({ tool: 'search_pages', summary: String(a.query ?? '') });
          return JSON.stringify(
            rows.slice(0, 12).map((r) => ({ pageId: r.pageId, title: r.title, snippet: r.snippet })),
          );
        }
        case 'list_spaces': {
          const rows = await this.spaces.list(principal);
          trace.push({ tool: 'list_spaces', summary: `${rows.length} spaces` });
          return JSON.stringify(rows.map((s) => ({ id: s.id, key: s.key, name: s.name })));
        }
        case 'list_pages': {
          const rows = await this.pages.list(principal, String(a.spaceId ?? ''), ctx, undefined);
          trace.push({ tool: 'list_pages', summary: `${rows.length} pages` });
          return clip(
            JSON.stringify(rows.map((p) => ({ id: p.id, title: p.title, parentId: p.parentId }))),
          );
        }
        case 'get_page': {
          const d = await this.pages.getById(principal, String(a.pageId ?? ''), ctx);
          trace.push({ tool: 'get_page', summary: d.page.title });
          return clip(JSON.stringify({ title: d.page.title, content: d.version?.content ?? '' }));
        }
        case 'list_attachments': {
          const rows = await this.attachments.list(
            principal,
            String(a.spaceId ?? ''),
            a.pageId ? String(a.pageId) : undefined,
            ctx,
          );
          trace.push({ tool: 'list_attachments', summary: `${rows.length} files` });
          return JSON.stringify(rows);
        }
        case 'create_page': {
          const d = await this.pages.create(
            principal,
            String(a.spaceId ?? ''),
            {
              title: String(a.title ?? ''),
              content: a.content ? String(a.content) : '',
              parentId: a.parentId ? String(a.parentId) : undefined,
            },
            ctx,
          );
          if (meta?.chatId) {
            // Stamp the originating chat so the page can offer "Revisit this chat".
            await this.pages.setMetadata(
              principal, d.page.id, { aiChat: { id: meta.chatId } }, { merge: true }, ctx,
            );
          }
          trace.push({ tool: 'create_page', summary: d.page.title });
          return JSON.stringify({ id: d.page.id, title: d.page.title, status: d.page.status });
        }
        case 'update_page': {
          const cur = await this.pages.getById(principal, String(a.pageId ?? ''), ctx);
          const d = await this.pages.update(
            principal,
            String(a.pageId ?? ''),
            {
              content: a.content != null ? String(a.content) : (cur.version?.content ?? ''),
              title: a.title != null ? String(a.title) : undefined,
              baseVersionNumber: cur.version?.versionNumber ?? 0,
              changeSummary: a.changeSummary ? String(a.changeSummary) : 'AI chat edit',
            },
            ctx,
          );
          trace.push({ tool: 'update_page', summary: d.page.title });
          return JSON.stringify({ id: d.page.id, title: d.page.title, versionNumber: d.version?.versionNumber });
        }
        case 'publish_page': {
          const page = await this.pages.publish(principal, String(a.pageId ?? ''), ctx);
          trace.push({ tool: 'publish_page', summary: page.title });
          return JSON.stringify({ id: page.id, title: page.title, status: page.status });
        }
        case 'automation_docs': {
          trace.push({ tool: 'automation_docs', summary: 'read' });
          return NETC_API_DOCS;
        }
        case 'list_automations': {
          const rows = await this.automations.list(principal, ctx);
          trace.push({ tool: 'list_automations', summary: `${rows.length} automations` });
          return clip(JSON.stringify(rows.map((r) => ({
            id: r.id, name: r.name, enabled: r.enabled, triggerType: r.triggerType,
          }))));
        }
        case 'get_automation': {
          const r = await this.automations.get(principal, String(a.automationId ?? ''), ctx);
          trace.push({ tool: 'get_automation', summary: r.name });
          return clip(JSON.stringify(r));
        }
        case 'create_automation': {
          const r = await this.automations.create(
            principal,
            {
              name: String(a.name ?? ''),
              description: a.description ? String(a.description) : undefined,
              enabled: false,
              triggerType: a.triggerType as 'page_event' | 'schedule' | 'webhook',
              triggerConfig: (a.triggerConfig ?? {}) as Record<string, unknown>,
              script: String(a.script ?? ''),
              timeoutMs: a.timeoutMs ? Number(a.timeoutMs) : 60000,
              debugMode: Boolean(a.debugMode ?? false),
              webhookSlug: a.webhookSlug ? String(a.webhookSlug) : undefined,
            },
            ctx,
          );
          trace.push({ tool: 'create_automation', summary: (r as { name?: string }).name ?? 'created' });
          return clip(JSON.stringify(r));
        }
        case 'update_automation': {
          const r = await this.automations.update(
            principal,
            String(a.automationId ?? ''),
            {
              name: a.name != null ? String(a.name) : undefined,
              description: a.description != null ? String(a.description) : undefined,
              enabled: a.enabled != null ? Boolean(a.enabled) : undefined,
              triggerConfig: a.triggerConfig as Record<string, unknown> | undefined,
              script: a.script != null ? String(a.script) : undefined,
              timeoutMs: a.timeoutMs != null ? Number(a.timeoutMs) : undefined,
              debugMode: a.debugMode != null ? Boolean(a.debugMode) : undefined,
            },
            ctx,
          );
          trace.push({ tool: 'update_automation', summary: (r as { name?: string }).name ?? 'updated' });
          return clip(JSON.stringify(r));
        }
        case 'test_automation': {
          const { runId } = await this.automations.testRun(
            principal,
            String(a.automationId ?? ''),
            {
              mockMode: Boolean(a.mockMode ?? true),
              simulatedEvent: a.simulatedEvent as Record<string, unknown> | undefined,
            },
            ctx,
          );
          const waitMs = (a.waitSeconds ? Number(a.waitSeconds) : 20) * 1000;
          const terminal = new Set(['success', 'error', 'timeout', 'killed', 'dead']);
          const started = Date.now();
          for (;;) {
            const { run: r, logs } = await this.automations.getRun(principal, runId, ctx);
            if (terminal.has(r.status) || Date.now() - started > waitMs) {
              trace.push({ tool: 'test_automation', summary: r.status });
              return clip(JSON.stringify({ run: r, logs }));
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        case 'get_automation_run': {
          const r = await this.automations.getRun(principal, String(a.runId ?? ''), ctx);
          trace.push({ tool: 'get_automation_run', summary: r.run.status });
          return clip(JSON.stringify(r));
        }
        case 'list_automation_variables': {
          const rows = await this.automations.listVariables(
            principal,
            ctx,
            a.automationId ? String(a.automationId) : undefined,
          );
          trace.push({ tool: 'list_automation_variables', summary: `${rows.length} variables` });
          return JSON.stringify(rows);
        }
        case 'set_automation_variable': {
          const r = await this.automations.setVariable(
            principal,
            a.automationId ? String(a.automationId) : 'global',
            String(a.name ?? ''),
            String(a.value ?? ''),
            Boolean(a.isSecure ?? false),
            ctx,
          );
          trace.push({ tool: 'set_automation_variable', summary: String(a.name ?? '') });
          return JSON.stringify(r);
        }
        case 'update_memory': {
          if (!principal.userId) return 'Memory requires a signed-in user.';
          const set = (a.set as Record<string, string> | undefined) ?? {};
          const remove = (a.remove as string[] | undefined) ?? [];
          const r = await this.memory.apply(principal.userId, set, remove);
          trace.push({ tool: 'update_memory', summary: r.applied.join(', ') || 'no change' });
          return JSON.stringify(r);
        }
        case 'get_attachment_text': {
          const c = await this.attachments.getTextContent(principal, String(a.attachmentId ?? ''), ctx);
          trace.push({ tool: 'get_attachment_text', summary: `${c.text.length} chars` });
          return clip(c.text);
        }
        default:
          return `Unknown tool "${call.name}".`;
      }
    } catch (err) {
      trace.push({ tool: call.name, summary: 'failed' });
      return `Tool error: ${(err as Error).message}`;
    }
  }

  /** Generic agent loop: call model, run requested tools, repeat until text. */
  private async runAgent(
    principal: Principal,
    ctx: AuditContext,
    cfg: AiProviderConfig & { webSearch?: boolean },
    system: string,
    turns: Turn[],
    meta?: { chatId?: string },
  ): Promise<{ text: string; trace: ToolTraceEntry[] }> {
    const trace: ToolTraceEntry[] = [];
    const opts = { webSearch: !!cfg.webSearch };
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const last = round === MAX_TOOL_ROUNDS;
      let reply: ModelReply;
      try {
        reply = await callModel(cfg, system, turns, last ? [] : TOOLS, opts);
      } catch (err) {
        this.logger.warn(`model call failed: ${(err as Error).message}`);
        throw new ServiceUnavailableException(`The model call failed: ${(err as Error).message}`);
      }
      for (const q of reply.serverSearches ?? []) trace.push({ tool: 'web_search', summary: q });
      if (!reply.calls?.length) return { text: reply.text ?? '', trace };
      turns.push({ role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw });
      for (const call of reply.calls) {
        const result = await this.runTool(principal, ctx, call, trace, meta);
        turns.push({ role: 'tool', id: call.id, name: call.name, result });
      }
    }
    return { text: 'I ran out of tool budget before finishing — try a narrower question.', trace };
  }

  /**
   * One chat turn: loads the stored history (when continuing a chat), runs the
   * agent, and persists the exchange. Chats belong to the signed-in user.
   */
  async chat(
    principal: Principal,
    ctx: AuditContext,
    input: { chatId?: string; message: string },
  ): Promise<ChatReply & { chatId: string; title: string }> {
    const cfg = await this.requireConfig();
    if (!principal.userId) throw new BadRequestException('Chat requires a signed-in user.');
    const chatId = await this.chats.ensure(principal.userId, input.chatId, input.message);
    const history: StoredChatMessage[] = input.chatId
      ? (await this.chats.get(principal.userId, input.chatId)).messages
      : [];
    const memoryBlock = await this.memory.renderForPrompt(principal.userId);

    const system = `You are the assistant built into "Notes Etc", the user's personal notes app.
Answer from their notes via your tools: search first, then read the specific pages you need.
Their notes are the source of truth about their home, infrastructure and documents; do not
invent facts about them. When you used a page, name it in the answer (plain title, no ids).
If the notes lack the needed information, say exactly what is missing and where you looked.
${cfg.webSearch
  ? 'You can also search the web — use it for public facts (product specs, prices, manuals online) and combine it with their notes; never let web results override what their notes say about their own home.'
  : 'You cannot browse the internet — if the user pastes a URL, say so and ask for the relevant details instead.'}
Keep answers concise; use Markdown.
When you learn a durable fact about the user (a preference, a place, a person), save it with
update_memory so future chats already know it. Check your long-term memory before searching
for things it already answers.
You can also CREATE and EDIT pages and automations. Ground rules: before overwriting a page,
get_page it and preserve everything the user didn't ask to change; new pages start as drafts —
publish them unless the user wants a draft; put new pages under a sensible parent; for
destructive changes (replacing large amounts of content, disabling automations) confirm with
the user first unless they clearly asked. After writing, say what you changed and name the page.
Never create an ENABLED automation without a successful mock test first.
Today's date: ${new Date().toISOString().slice(0, 10)}.${memoryBlock}`;

    const turns: Turn[] = [
      ...history.map((m): Turn =>
        m.role === 'user' ? { role: 'user', text: m.content } : { role: 'assistant', text: m.content },
      ),
      { role: 'user', text: input.message },
    ];
    // Same permissions as the user, but writes are attributed to the AI.
    const agentPrincipal: Principal = { ...principal, actorType: ActorType.AiTool, agentLabel: 'chat' };
    const { text, trace } = await this.runAgent(agentPrincipal, ctx, cfg, system, turns, { chatId });
    const saved = await this.chats.append(principal.userId, chatId, [
      { role: 'user', content: input.message },
      { role: 'assistant', content: text, trace },
    ]);
    return { reply: text, trace, chatId: saved.id, title: saved.title };
  }

  /** Token/cost estimate for including an attachment's text in an AI request. */
  async estimate(
    principal: Principal,
    ctx: AuditContext,
    attachmentId: string,
  ): Promise<{ chars: number; tokens: number; estUsd: number | null; tooLarge: boolean }> {
    const cfg = await this.requireConfig();
    const content = await this.attachments.getTextContent(principal, attachmentId, ctx);
    const chars = content.text.length;
    const tokens = Math.ceil(chars / 4);
    return {
      chars,
      tokens,
      estUsd: estimateUsd(cfg.provider, cfg.model, tokens),
      tooLarge: tokens > CONTENT_TOKEN_CAP,
    };
  }

  /**
   * "File this document": the agent explores the user's notes and proposes the best
   * page to attach the document to, with an optional summary. Returns a
   * PROPOSAL — the client applies it after the user confirms.
   */
  async suggestFiling(
    principal: Principal,
    ctx: AuditContext,
    input: { attachmentId: string; prompt?: string; includeContent: boolean },
  ): Promise<FilingSuggestion> {
    const cfg = await this.requireConfig();
    const meta = await this.attachments.getMeta(principal, input.attachmentId, ctx);

    let contentBlock = '';
    if (input.includeContent) {
      try {
        const c = await this.attachments.getTextContent(principal, input.attachmentId, ctx);
        if (Math.ceil(c.text.length / 4) > CONTENT_TOKEN_CAP) {
          throw new BadRequestException(
            'Document content is too large to include — retry without content.',
          );
        }
        contentBlock = `\n\nDocument content:\n"""\n${clip(c.text, 120_000)}\n"""`;
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        contentBlock = '\n\n(No text could be extracted from this document.)';
      }
    }

    const memoryBlock = principal.userId ? await this.memory.renderForPrompt(principal.userId) : '';
    const system = `You are the filing assistant for "Notes Etc", the user's personal notes app.
A user uploaded a document; find the single best existing page in their notes to attach it to.
Explore with your tools (search, list_pages for the tree, get_page to confirm).
The attachment lives in one space and can only be filed onto a page IN THAT SPACE.
When done, reply with ONLY a JSON object, no prose, no code fences:
{"pageId": "<id of the chosen page>", "summary": "<1-3 sentence summary of the document, or null if you had no content>", "rationale": "<one sentence: why this page>"}${memoryBlock}`;

    const user = `The document lives in space ${meta.spaceId} — only pages in this space are valid targets.
Filename: ${meta.filename}
Type: ${meta.contentType}
User's description: ${input.prompt?.trim() || '(none given)'}${contentBlock}`;

    const { text, trace } = await this.runAgent(principal, ctx, cfg, system, [
      { role: 'user', text: user },
    ]);

    const parsed = this.parseFilingJson(text);
    const page = await this.pages.getById(principal, parsed.pageId, ctx); // validates existence + read access
    if (page.page.spaceId !== meta.spaceId) {
      throw new BadRequestException(
        `The model chose "${page.page.title}", which is in a different space than the attachment.`,
      );
    }

    const embed = `[${meta.filename}](attachment:${meta.id})`;
    const appendMarkdown = parsed.summary
      ? `\n\n::::section blue ${meta.filename}\n${parsed.summary}\n\n${embed}\n::::`
      : `\n\n${embed}`;

    return {
      pageId: page.page.id,
      pageTitle: page.page.title,
      summary: parsed.summary,
      rationale: parsed.rationale,
      appendMarkdown,
      trace,
    };
  }

  private parseFilingJson(text: string): { pageId: string; summary: string | null; rationale: string } {
    const raw = text.replace(/```(?:json)?/g, '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new BadRequestException(`The model did not return a valid suggestion: ${clip(text, 300)}`);
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      throw new BadRequestException(`The model returned malformed JSON: ${clip(match[0], 300)}`);
    }
    const pageId = String(obj.pageId ?? '');
    if (!pageId) throw new BadRequestException('The model did not pick a page.');
    return {
      pageId,
      summary: obj.summary == null || obj.summary === 'null' ? null : String(obj.summary),
      rationale: String(obj.rationale ?? ''),
    };
  }

  /** Apply a confirmed filing: append the embed to the page and link the attachment. */
  async applyFiling(
    principal: Principal,
    ctx: AuditContext,
    input: { attachmentId: string; pageId: string; appendMarkdown: string },
  ): Promise<{ pageId: string }> {
    const meta = await this.attachments.getMeta(principal, input.attachmentId, ctx);
    const detail = await this.pages.getById(principal, input.pageId, ctx);
    if (detail.page.spaceId !== meta.spaceId) {
      throw new BadRequestException('The page is in a different space than the attachment.');
    }
    const current = detail.version;
    await this.pages.update(
      principal,
      input.pageId,
      {
        content: (current?.content ?? '') + input.appendMarkdown,
        baseVersionNumber: current?.versionNumber ?? 0,
        changeSummary: `AI filing: attached ${meta.filename}`,
      },
      ctx,
    );
    await this.attachments.linkToPage(principal, input.attachmentId, input.pageId, ctx);
    return { pageId: input.pageId };
  }
}
