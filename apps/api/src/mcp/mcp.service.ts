import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ActorType, type Principal, PrincipalVia } from '@notesetc/shared';
import type { AuditContext } from '../audit/audit.service';
import { ApiTokenService } from '../auth/api-token.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { AutomationsService } from '../automations/automations.service';
import { NETC_API_DOCS } from '../automations/netc-api-docs';
import { PagesService } from '../pages/pages.service';
import { SearchService } from '../search/search.service';
import { SpacesService } from '../spaces/spaces.service';

// The SDK ships an `exports` map that classic TS "Node" resolution can't follow,
// but Node's require honours it at runtime (resolving the CJS build). require()
// returns `any`, which sidesteps the resolution mismatch cleanly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js') as {
  McpServer: new (info: { name: string; version: string }) => McpServerLike;
};

interface McpServerLike {
  registerTool(
    name: string,
    config: { title?: string; description: string; inputSchema?: Record<string, unknown> },
    handler: (args: Record<string, unknown>) => Promise<ToolResult>,
  ): void;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/** Run a service call, surfacing permission/validation errors as clean tool errors. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err: unknown) {
    const e = err as { response?: { message?: string | string[] }; message?: string };
    const msg = e.response?.message ?? e.message ?? 'Request failed.';
    return fail(Array.isArray(msg) ? msg.join('; ') : String(msg));
  }
}

/**
 * The MCP face of Notes Etc. Tools call the SAME service layer as REST + the web
 * UI, so authorization and audit are enforced identically — an AI agent can never
 * exceed its token's permissions, and its writes are attributed as `ai_tool`.
 */
@Injectable()
export class McpService {
  constructor(
    private readonly apiTokens: ApiTokenService,
    private readonly spaces: SpacesService,
    private readonly pages: PagesService,
    private readonly search: SearchService,
    private readonly automations: AutomationsService,
    private readonly attachments: AttachmentsService,
  ) {}

  /** Resolve a Bearer header to an MCP principal (token owner, tagged ai_tool/mcp). */
  async resolvePrincipal(authHeader: string | undefined): Promise<Principal | null> {
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
    const base = await this.apiTokens.resolvePrincipal(authHeader.slice(7));
    if (!base) return null;
    return { ...base, via: PrincipalVia.Mcp, actorType: ActorType.AiTool, agentLabel: 'mcp' };
  }

  buildServer(principal: Principal, ctx: AuditContext): McpServerLike {
    const server = new McpServer({ name: 'notesetc', version: '1.0.0' });

    server.registerTool(
      'list_spaces',
      { title: 'List spaces', description: 'List the spaces this token can read.', inputSchema: {} },
      () => run(async () => {
        const data = await this.spaces.list(principal);
        return data.map((s) => ({ id: s.id, key: s.key, name: s.name, status: s.status }));
      }),
    );

    server.registerTool(
      'create_space',
      {
        title: 'Create space',
        description:
          'Create a new space (global admin). The key must be uppercase letters/digits starting with a letter (e.g. HOME, IT-2). The creator becomes its space admin.',
        inputSchema: {
          key: z.string().min(2).max(32).describe('Uppercase key, e.g. HOME.'),
          name: z.string().min(1).max(200).describe('Display name.'),
          description: z.string().max(2000).optional(),
          icon: z.string().optional().describe('Optional icon name.'),
        },
      },
      (args) =>
        run(async () => {
          const sp = await this.spaces.create(
            principal,
            {
              key: String(args.key),
              name: String(args.name),
              description: args.description ? String(args.description) : undefined,
              icon: args.icon ? String(args.icon) : undefined,
            },
            ctx,
          );
          return { id: sp.id, key: sp.key, name: sp.name, status: sp.status };
        }),
    );

    server.registerTool(
      'update_space',
      {
        title: 'Update space',
        description:
          'Rename a space or change its description/icon/overview (space admin+). The key is immutable. Pass only the fields to change.',
        inputSchema: {
          spaceId: z.string().describe('The space id.'),
          name: z.string().min(1).max(200).optional().describe('New display name.'),
          description: z.string().max(2000).nullable().optional(),
          icon: z.string().nullable().optional(),
          overview: z.string().max(100_000).nullable().optional().describe('Space landing content (Markdown).'),
        },
      },
      (args) =>
        run(async () => {
          const patch: Record<string, unknown> = {};
          if (args.name !== undefined) patch.name = String(args.name);
          if (args.description !== undefined) patch.description = args.description === null ? null : String(args.description);
          if (args.icon !== undefined) patch.icon = args.icon === null ? null : String(args.icon);
          if (args.overview !== undefined) patch.overview = args.overview === null ? null : String(args.overview);
          const sp = await this.spaces.update(principal, String(args.spaceId), patch, ctx);
          return { id: sp.id, key: sp.key, name: sp.name, status: sp.status };
        }),
    );

    server.registerTool(
      'archive_space',
      {
        title: 'Archive space',
        description:
          'Archive a space (space admin+). Archiving HIDES the space and its pages but deletes nothing — the reversible alternative to deletion. Use unarchive_space to restore it. There is no hard delete.',
        inputSchema: { spaceId: z.string().describe('The space id.') },
      },
      (args) =>
        run(async () => {
          const sp = await this.spaces.archive(principal, String(args.spaceId), ctx);
          return { id: sp.id, key: sp.key, name: sp.name, status: sp.status };
        }),
    );

    server.registerTool(
      'unarchive_space',
      {
        title: 'Unarchive space',
        description: 'Restore an archived space (space admin+).',
        inputSchema: { spaceId: z.string().describe('The space id.') },
      },
      (args) =>
        run(async () => {
          const sp = await this.spaces.unarchive(principal, String(args.spaceId), ctx);
          return { id: sp.id, key: sp.key, name: sp.name, status: sp.status };
        }),
    );

    server.registerTool(
      'search_pages',
      {
        title: 'Search pages',
        description: 'Full-text search across pages the caller can read. Returns matches with snippets.',
        inputSchema: { query: z.string().min(2).describe('Search terms.') },
      },
      (args) => run(() => this.search.query(principal, String(args.query), undefined)),
    );

    server.registerTool(
      'list_pages',
      {
        title: 'List pages',
        description:
          'List pages in a space. Omit parentId for all pages; pass a page id to list only its direct children.',
        inputSchema: {
          spaceId: z.string().describe('The space id (from list_spaces).'),
          parentId: z.string().optional().describe('Optional parent page id.'),
        },
      },
      (args) =>
        run(async () => {
          const data = await this.pages.list(
            principal,
            String(args.spaceId),
            ctx,
            args.parentId ? String(args.parentId) : undefined,
          );
          return data.map((p) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            status: p.status,
            parentId: p.parentId,
            hasChildren: p.hasChildren,
          }));
        }),
    );

    server.registerTool(
      'get_page',
      {
        title: 'Get page',
        description:
          'Fetch a page with its current Markdown content and version number (needed as baseVersionNumber to update).',
        inputSchema: { pageId: z.string().describe('The page id.') },
      },
      (args) =>
        run(async () => {
          const d = await this.pages.getById(principal, String(args.pageId), ctx);
          return {
            id: d.page.id,
            title: d.page.title,
            status: d.page.status,
            spaceId: d.page.spaceId,
            parentId: d.page.parentId,
            versionNumber: d.version?.versionNumber ?? null,
            content: d.version?.content ?? '',
            capabilities: d.capabilities,
          };
        }),
    );

    server.registerTool(
      'create_page',
      {
        title: 'Create page',
        description: 'Create a new page in a space (requires editor access). Content is NEFM Markdown.',
        inputSchema: {
          spaceId: z.string().describe('The space id.'),
          title: z.string().min(1).describe('Page title.'),
          content: z.string().optional().describe('Markdown body.'),
          parentId: z.string().optional().describe('Optional parent page id to nest under.'),
        },
      },
      (args) =>
        run(async () => {
          const d = await this.pages.create(
            principal,
            String(args.spaceId),
            {
              title: String(args.title),
              content: args.content ? String(args.content) : '',
              parentId: args.parentId ? String(args.parentId) : undefined,
            },
            ctx,
          );
          return { id: d.page.id, title: d.page.title, versionNumber: d.version?.versionNumber ?? null };
        }),
    );

    server.registerTool(
      'update_page',
      {
        title: 'Update page',
        description:
          'Update a page (requires editor access). Fetch the page first with get_page and pass its versionNumber as baseVersionNumber; a mismatch means someone else edited it.',
        inputSchema: {
          pageId: z.string().describe('The page id.'),
          baseVersionNumber: z.number().int().positive().describe('The versionNumber from get_page.'),
          title: z.string().optional().describe('New title (optional).'),
          content: z.string().optional().describe('New Markdown body (optional).'),
          changeSummary: z.string().optional().describe('Optional note describing the change.'),
        },
      },
      (args) =>
        run(async () => {
          const d = await this.pages.update(
            principal,
            String(args.pageId),
            {
              baseVersionNumber: Number(args.baseVersionNumber),
              title: args.title !== undefined ? String(args.title) : undefined,
              content: args.content !== undefined ? String(args.content) : undefined,
              changeSummary: args.changeSummary !== undefined ? String(args.changeSummary) : undefined,
            },
            ctx,
          );
          return { id: d.page.id, versionNumber: d.version?.versionNumber ?? null };
        }),
    );

    server.registerTool(
      'publish_page',
      {
        title: 'Publish page',
        description:
          'Publish a page (draft -> published), making it visible to viewers. Newly created pages start as drafts. Requires editor access.',
        inputSchema: { pageId: z.string().describe('The page id.') },
      },
      (args) =>
        run(async () => {
          const page = await this.pages.publish(principal, String(args.pageId), ctx);
          return { id: page.id, title: page.title, status: page.status };
        }),
    );

    // ---- automations (global-admin token owners only; authz enforced in service) ----

    server.registerTool(
      'list_attachments',
      {
        title: 'List attachments',
        description:
          'List document attachments in a space (PDF/Word/Excel/text/CSV/images). Pass pageId to only list files linked to that page. Embed one in page content with [name](attachment:<id>) for a link chip, [name](attachment:<id>?icon) for a bare icon, or a `:::attach <id> <name>` block (closed by `:::`) for an inline reader.',
        inputSchema: {
          spaceId: z.string().describe('The space id (from list_spaces).'),
          pageId: z.string().optional().describe('Optional page id to filter by.'),
        },
      },
      (args) =>
        run(() =>
          this.attachments.list(
            principal,
            String(args.spaceId),
            args.pageId ? String(args.pageId) : undefined,
            ctx,
          ),
        ),
    );

    server.registerTool(
      'get_attachment',
      {
        title: 'Get attachment',
        description:
          'Attachment metadata plus ready-to-paste embed snippets. Set includeContent=true to also get extracted text — works for txt, csv, pdf, docx and xlsx (capped at 256 KB). Only legacy .doc and images have no text extraction.',
        inputSchema: {
          attachmentId: z.string().describe('The attachment id.'),
          includeContent: z
            .boolean()
            .optional()
            .describe('Include extracted text (txt/csv/pdf/docx/xlsx).'),
        },
      },
      (args) =>
        run(async () => {
          const id = String(args.attachmentId);
          const meta = await this.attachments.getMeta(principal, id, ctx);
          const name = meta.filename;
          const result: Record<string, unknown> = {
            ...meta,
            embed: {
              link: `[${name}](attachment:${meta.id})`,
              icon: `[${name}](attachment:${meta.id}?icon)`,
              reader: `:::attach ${meta.id} ${name}\n:::`,
            },
          };
          if (args.includeContent) {
            try {
              result.content = await this.attachments.getTextContent(principal, id, ctx);
            } catch {
              result.contentNote = `No text extractor for ${meta.contentType}.`;
            }
          }
          return result;
        }),
    );

    server.registerTool(
      'upload_attachment',
      {
        title: 'Upload attachment',
        description:
          'Upload a document into a space (editor+). Allowed: pdf, docx, doc, xlsx, txt, csv, png, jpg, gif, webp — type is validated against the file bytes. Returns the id and embed snippets for page content. Documents cap at 25 MB (10 MB for images); note base64 inflates the payload ~4/3.',
        inputSchema: {
          spaceId: z.string().describe('The space id to upload into.'),
          filename: z.string().min(1).describe('Filename with extension, e.g. report.pdf.'),
          contentBase64: z.string().min(1).describe('The file bytes, base64-encoded.'),
          pageId: z.string().optional().describe('Optional page id to link the file to.'),
        },
      },
      (args) =>
        run(async () => {
          const buffer = Buffer.from(String(args.contentBase64), 'base64');
          const filename = String(args.filename);
          const uploaded = await this.attachments.upload(
            principal,
            String(args.spaceId),
            { buffer, originalname: filename, mimetype: '', size: buffer.length },
            args.pageId ? String(args.pageId) : undefined,
            ctx,
          );
          return {
            ...uploaded,
            embed: {
              link: `[${uploaded.filename}](attachment:${uploaded.id})`,
              icon: `[${uploaded.filename}](attachment:${uploaded.id}?icon)`,
              reader: `:::attach ${uploaded.id} ${uploaded.filename}\n:::`,
            },
          };
        }),
    );

    server.registerTool(
      'automation_docs',
      {
        title: 'Automation scripting reference',
        description:
          'Read this FIRST before creating or editing an automation. Returns the full reference for the netc.* scripting API, trigger config shapes (page_event/schedule/webhook), variables, mock mode, and the loop-guard rules.',
        inputSchema: {},
      },
      () => Promise.resolve({ content: [{ type: 'text' as const, text: NETC_API_DOCS }] }),
    );

    server.registerTool(
      'list_automations',
      {
        title: 'List automations',
        description: 'List all automations with trigger type and enabled state. Global admin only.',
        inputSchema: {},
      },
      () =>
        run(async () => {
          const data = await this.automations.list(principal, ctx);
          return data.map((a) => ({
            id: a.id,
            name: a.name,
            enabled: a.enabled,
            triggerType: a.triggerType,
            triggerConfig: a.triggerConfig,
            timeoutMs: a.timeoutMs,
            webhookSlug: a.webhookSlug,
          }));
        }),
    );

    server.registerTool(
      'get_automation',
      {
        title: 'Get automation',
        description: 'Fetch one automation including its script and trigger config.',
        inputSchema: { automationId: z.string().describe('The automation id.') },
      },
      (args) => run(() => this.automations.get(principal, String(args.automationId), ctx)),
    );

    server.registerTool(
      'create_automation',
      {
        title: 'Create automation',
        description:
          'Create a JavaScript automation (created DISABLED; test it, then enable via update_automation). ' +
          'Call automation_docs first for the netc.* API and triggerConfig shapes. ' +
          'Triggers: page_event {events[, spaceIds]}, schedule {cron[, timezone]}, webhook {} (returns the X-Hook-Secret ONCE). ' +
          'The script runs sandboxed with top-level await; use netc.log/netc.pages.*/netc.variable/netc.fetch.',
        inputSchema: {
          name: z.string().min(1).describe('Automation name.'),
          description: z.string().optional().describe('What it does.'),
          triggerType: z.enum(['page_event', 'schedule', 'webhook']).describe('What fires it.'),
          triggerConfig: z
            .record(z.string(), z.unknown())
            .describe('Shape depends on triggerType — see automation_docs.'),
          script: z.string().describe('The JavaScript body (top-level await allowed).'),
          timeoutMs: z.number().int().min(1000).max(600000).optional().describe('Kill timeout, default 60000.'),
          debugMode: z.boolean().optional().describe('Persist console.* output to run logs.'),
          webhookSlug: z.string().optional().describe('Webhook trigger only: URL slug.'),
        },
      },
      (args) =>
        run(() =>
          this.automations.create(
            principal,
            {
              name: String(args.name),
              description: args.description ? String(args.description) : undefined,
              enabled: false,
              triggerType: args.triggerType as 'page_event' | 'schedule' | 'webhook',
              triggerConfig: (args.triggerConfig ?? {}) as Record<string, unknown>,
              script: String(args.script),
              timeoutMs: args.timeoutMs ? Number(args.timeoutMs) : 60000,
              debugMode: Boolean(args.debugMode ?? false),
              webhookSlug: args.webhookSlug ? String(args.webhookSlug) : undefined,
            },
            ctx,
          ),
        ),
    );

    server.registerTool(
      'update_automation',
      {
        title: 'Update automation',
        description:
          'Update an automation (script, trigger config, timeout, debugMode) and/or toggle {enabled}. Trigger TYPE cannot change.',
        inputSchema: {
          automationId: z.string().describe('The automation id.'),
          name: z.string().optional(),
          description: z.string().optional(),
          enabled: z.boolean().optional().describe('Enable/disable the automation.'),
          triggerConfig: z.record(z.string(), z.unknown()).optional(),
          script: z.string().optional(),
          timeoutMs: z.number().int().min(1000).max(600000).optional(),
          debugMode: z.boolean().optional(),
        },
      },
      (args) =>
        run(() =>
          this.automations.update(
            principal,
            String(args.automationId),
            {
              name: args.name !== undefined ? String(args.name) : undefined,
              description: args.description !== undefined ? String(args.description) : undefined,
              enabled: args.enabled !== undefined ? Boolean(args.enabled) : undefined,
              triggerConfig:
                args.triggerConfig !== undefined
                  ? (args.triggerConfig as Record<string, unknown>)
                  : undefined,
              script: args.script !== undefined ? String(args.script) : undefined,
              timeoutMs: args.timeoutMs !== undefined ? Number(args.timeoutMs) : undefined,
              debugMode: args.debugMode !== undefined ? Boolean(args.debugMode) : undefined,
            },
            ctx,
          ),
        ),
    );

    server.registerTool(
      'test_automation',
      {
        title: 'Test automation',
        description:
          'Run an automation now and wait for the result (returns run status + logs). mockMode=true (default) is a safe dry-run: reads are real, writes are logged but NOT applied. Works while the automation is disabled — the intended dev loop is create → test_automation → fix → enable.',
        inputSchema: {
          automationId: z.string().describe('The automation id.'),
          mockMode: z.boolean().optional().describe('Default true (dry-run).'),
          simulatedEvent: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Optional fake netc.trigger fields, e.g. {"type":"page.updated","pageId":"…"}.'),
          waitSeconds: z.number().int().min(1).max(60).optional().describe('How long to wait, default 20.'),
        },
      },
      (args) =>
        run(async () => {
          const { runId } = await this.automations.testRun(
            principal,
            String(args.automationId),
            {
              mockMode: Boolean(args.mockMode ?? true),
              simulatedEvent: args.simulatedEvent as Record<string, unknown> | undefined,
            },
            ctx,
          );
          const waitMs = (args.waitSeconds ? Number(args.waitSeconds) : 20) * 1000;
          const terminal = new Set(['success', 'error', 'timeout', 'killed', 'dead']);
          const started = Date.now();
          for (;;) {
            const { run: r, logs } = await this.automations.getRun(principal, runId, ctx);
            if (terminal.has(r.status) || Date.now() - started > waitMs) {
              return {
                runId,
                status: r.status,
                error: r.error,
                stillRunning: !terminal.has(r.status),
                logs: logs.map((l) => ({ state: l.state, source: l.source, message: l.message, data: l.data })),
              };
            }
            await new Promise((res) => setTimeout(res, 700));
          }
        }),
    );

    server.registerTool(
      'get_automation_run',
      {
        title: 'Get automation run',
        description: 'Fetch one run with its status and structured logs (for runs still going after test_automation timed out, or historical runs).',
        inputSchema: { runId: z.string().describe('The run id.') },
      },
      (args) => run(() => this.automations.getRun(principal, String(args.runId), ctx)),
    );

    server.registerTool(
      'list_automation_variables',
      {
        title: 'List automation variables',
        description:
          'List variables scripts read with netc.variable(name). Omit automationId for GLOBAL variables; pass it for that script’s scoped variables (which shadow globals of the same name). Secure variable VALUES are never returned.',
        inputSchema: {
          automationId: z.string().optional().describe('Scope: omit = global, or an automation id.'),
        },
      },
      (args) =>
        run(() =>
          this.automations.listVariables(
            principal,
            ctx,
            args.automationId ? String(args.automationId) : undefined,
          ),
        ),
    );

    server.registerTool(
      'set_automation_variable',
      {
        title: 'Set automation variable',
        description:
          'Create or update a variable for netc.variable(name). Prefer SCRIPT-SCOPED (pass automationId) — global only for values shared across automations. Set isSecure=true for API keys/passwords: encrypted at rest, never shown again, auto-redacted from run logs.',
        inputSchema: {
          name: z.string().min(1).max(100).describe('Variable name (letters, digits, _ . -).'),
          value: z.string().describe('The value.'),
          isSecure: z.boolean().optional().describe('Encrypt at rest; write-only. Default false.'),
          automationId: z
            .string()
            .optional()
            .describe('Scope to one automation (recommended). Omit for a global variable.'),
        },
      },
      (args) =>
        run(() =>
          this.automations.setVariable(
            principal,
            args.automationId ? String(args.automationId) : 'global',
            String(args.name),
            String(args.value),
            Boolean(args.isSecure ?? false),
            ctx,
          ),
        ),
    );

    return server;
  }
}
