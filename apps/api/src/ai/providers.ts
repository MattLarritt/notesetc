/**
 * Thin, dependency-free adapters over the four supported model APIs
 * (Anthropic, OpenAI, Google Gemini, Ollama), normalised to one tool-calling
 * chat interface. Each adapter maps the provider-agnostic transcript to the
 * provider's wire format, makes ONE non-streaming call, and returns text
 * and/or tool calls.
 */

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export interface AiProviderConfig {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  /** Override the API origin (required for Ollama, optional elsewhere). */
  baseUrl?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Provider-agnostic transcript turn. `raw` carries provider-specific items
 * (OpenAI Responses reasoning/function_call items) that must be echoed back
 * verbatim on the next round; other providers ignore it. */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; calls?: ToolCall[]; raw?: unknown[] }
  | { role: 'tool'; id: string; name: string; result: string };

export interface ModelReply {
  text?: string;
  calls?: ToolCall[];
  /** Provider items to echo back next round (OpenAI Responses only). */
  raw?: unknown[];
  /** Server-side searches the provider ran (for the user-visible trace). */
  serverSearches?: string[];
}

export interface CallOptions {
  /** Let the provider use its native web-search tool (where supported). */
  webSearch?: boolean;
}

const TIMEOUT_MS = 120_000;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`${res.status} from model API: ${detail}`);
  }
  return res.json();
}

// ---------------------------------------------------------------- anthropic

async function callAnthropic(
  cfg: AiProviderConfig,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
  opts: CallOptions,
): Promise<ModelReply> {
  type Block =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; tool_use_id: string; content: string };
  const messages: { role: 'user' | 'assistant'; content: Block[] }[] = [];
  for (const t of turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: [{ type: 'text', text: t.text }] });
    else if (t.role === 'assistant') {
      const content: Block[] = [];
      if (t.text) content.push({ type: 'text', text: t.text });
      for (const c of t.calls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      messages.push({ role: 'assistant', content });
    } else {
      // Consecutive tool results must merge into one user turn.
      const block: Block = { type: 'tool_result', tool_use_id: t.id, content: t.result };
      const last = messages[messages.length - 1];
      if (last?.role === 'user' && last.content.some((b) => b.type === 'tool_result')) last.content.push(block);
      else messages.push({ role: 'user', content: [block] });
    }
  }
  const data = (await post(
    `${cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
    { 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    {
      model: cfg.model,
      max_tokens: 4096,
      system,
      messages,
      ...(tools.length || opts.webSearch
        ? {
            tools: [
              ...tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
              // Server-side tool: Anthropic runs the searches within this call.
              ...(opts.webSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] : []),
            ],
          }
        : {}),
    },
  )) as { content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] };
  const reply: ModelReply = {};
  for (const block of data.content ?? []) {
    if (block.type === 'text' && block.text) reply.text = (reply.text ?? '') + block.text;
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      const q = (block.input as { query?: string } | undefined)?.query;
      if (q) (reply.serverSearches ??= []).push(q);
    }
    if (block.type === 'tool_use') {
      (reply.calls ??= []).push({
        id: block.id ?? `call_${Math.random().toString(36).slice(2)}`,
        name: block.name ?? '',
        args: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }
  return reply;
}

// ---------------------------------------------------- openai (and clones)

interface OpenAiToolCall {
  id: string;
  function: { name: string; arguments: string };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Modern path: the Responses API. Required for current OpenAI reasoning
 * models (gpt-5.x): /v1/chat/completions rejects function tools unless
 * reasoning is disabled. Also home of the built-in web_search tool.
 * Reasoning + function_call output items are echoed back verbatim between
 * rounds via Turn.raw, which the Responses API needs for stateful reasoning.
 */
async function callOpenAiResponses(
  cfg: AiProviderConfig,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
  opts: CallOptions,
): Promise<ModelReply> {
  const input: unknown[] = [];
  for (const t of turns) {
    if (t.role === 'user') input.push({ role: 'user', content: [{ type: 'input_text', text: t.text }] });
    else if (t.role === 'assistant') {
      if (t.raw?.length) input.push(...t.raw);
      else if (t.text) input.push({ role: 'assistant', content: [{ type: 'output_text', text: t.text }] });
    } else input.push({ type: 'function_call_output', call_id: t.id, output: t.result });
  }
  const toolList: unknown[] = tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  if (opts.webSearch) toolList.push({ type: 'web_search' });

  const data = (await post(
    `${cfg.baseUrl ?? 'https://api.openai.com/v1'}/responses`,
    { authorization: `Bearer ${cfg.apiKey ?? ''}` },
    {
      model: cfg.model,
      instructions: system,
      input,
      ...(toolList.length ? { tools: toolList } : {}),
    },
  )) as {
    output?: {
      type: string;
      id?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: { type: string; text?: string }[];
      action?: { query?: string };
    }[];
  };

  const reply: ModelReply = {};
  const raw: unknown[] = [];
  for (const item of data.output ?? []) {
    if (item.type === 'message') {
      for (const c of item.content ?? []) if (c.type === 'output_text' && c.text) reply.text = (reply.text ?? '') + c.text;
      raw.push(item);
    } else if (item.type === 'function_call') {
      (reply.calls ??= []).push({ id: item.call_id ?? '', name: item.name ?? '', args: parseArgs(item.arguments ?? '') });
      raw.push(item);
    } else if (item.type === 'reasoning') {
      raw.push(item);
    } else if (item.type === 'web_search_call') {
      const q = item.action?.query;
      if (q) (reply.serverSearches ??= []).push(q);
    }
  }
  if (raw.length) reply.raw = raw;
  return reply;
}

/** Compat path for custom OpenAI-style endpoints: classic chat/completions. */
async function callOpenAiCompat(
  cfg: AiProviderConfig,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
): Promise<ModelReply> {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: t.text ?? null,
        ...(t.calls?.length
          ? {
              tool_calls: t.calls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      });
    } else messages.push({ role: 'tool', tool_call_id: t.id, content: t.result });
  }
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
  };
  const url = `${cfg.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`;
  const headers = { authorization: `Bearer ${cfg.apiKey ?? ''}` };
  let data: { choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[] };
  try {
    data = (await post(url, headers, body)) as typeof data;
  } catch (err) {
    // Reasoning models refuse function tools here unless reasoning is off.
    if (tools.length && /reasoning_effort/i.test((err as Error).message)) {
      data = (await post(url, headers, { ...body, reasoning_effort: 'none' })) as typeof data;
    } else throw err;
  }
  const msg = data.choices?.[0]?.message;
  const reply: ModelReply = {};
  if (msg?.content) reply.text = msg.content;
  for (const c of msg?.tool_calls ?? []) {
    (reply.calls ??= []).push({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) });
  }
  return reply;
}

function callOpenAi(
  cfg: AiProviderConfig,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
  opts: CallOptions,
): Promise<ModelReply> {
  // Real OpenAI gets the Responses API; custom base URLs (LiteLLM, OpenRouter,
  // LM Studio, …) generally only implement chat/completions.
  const useResponses = !cfg.baseUrl || /api\.openai\.com/.test(cfg.baseUrl);
  return useResponses
    ? callOpenAiResponses(cfg, system, turns, tools, opts)
    : callOpenAiCompat(cfg, system, turns, tools);
}

// ------------------------------------------------------------------ gemini

async function callGemini(
  cfg: AiProviderConfig,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
  opts: CallOptions,
): Promise<ModelReply> {
  type Part =
    | { text: string }
    | { functionCall: { name: string; args: unknown } }
    | { functionResponse: { name: string; response: { result: string } } };
  const contents: { role: 'user' | 'model'; parts: Part[] }[] = [];
  for (const t of turns) {
    if (t.role === 'user') contents.push({ role: 'user', parts: [{ text: t.text }] });
    else if (t.role === 'assistant') {
      const parts: Part[] = [];
      if (t.text) parts.push({ text: t.text });
      for (const c of t.calls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
      contents.push({ role: 'model', parts });
    } else {
      const part: Part = { functionResponse: { name: t.name, response: { result: t.result } } };
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.some((p) => 'functionResponse' in p)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  const base = cfg.baseUrl ?? 'https://generativelanguage.googleapis.com';
  const data = (await post(
    `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
    { 'x-goog-api-key': cfg.apiKey ?? '' },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(tools.length || opts.webSearch
        ? {
            tools: [
              ...(tools.length
                ? [{
                    functionDeclarations: tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: t.parameters,
                    })),
                  }]
                : []),
              ...(opts.webSearch ? [{ google_search: {} }] : []),
            ],
          }
        : {}),
    },
  )) as {
    candidates?: {
      content?: { parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[] };
      groundingMetadata?: { webSearchQueries?: string[] };
    }[];
  };
  const reply: ModelReply = {};
  const queries = data.candidates?.[0]?.groundingMetadata?.webSearchQueries;
  if (queries?.length) reply.serverSearches = queries;
  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    if (part.text) reply.text = (reply.text ?? '') + part.text;
    if (part.functionCall) {
      (reply.calls ??= []).push({
        // Gemini has no call ids; the name doubles as the correlation key.
        id: part.functionCall.name,
        name: part.functionCall.name,
        args: (part.functionCall.args as Record<string, unknown>) ?? {},
      });
    }
  }
  return reply;
}

// ------------------------------------------------------------------ ollama

async function callOllama(
  cfg: AiProviderConfig,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
): Promise<ModelReply> {
  // No web search here: Ollama is local and has no server-side search tool.
  const messages: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: t.text ?? '',
        ...(t.calls?.length
          ? { tool_calls: t.calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }
          : {}),
      });
    } else messages.push({ role: 'tool', content: t.result });
  }
  const data = (await post(
    `${cfg.baseUrl ?? 'http://localhost:11434'}/api/chat`,
    {},
    {
      model: cfg.model,
      messages,
      stream: false,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    },
  )) as { message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] } };
  const reply: ModelReply = {};
  if (data.message?.content) reply.text = data.message.content;
  data.message?.tool_calls?.forEach((c, i) => {
    (reply.calls ??= []).push({
      id: `${c.function.name}_${i}`,
      name: c.function.name,
      args: (c.function.arguments as Record<string, unknown>) ?? {},
    });
  });
  return reply;
}

// -------------------------------------------------------------- dispatcher

export function callModel(
  cfg: AiProviderConfig,
  system: string,
  turns: Turn[],
  tools: ToolDef[],
  opts: CallOptions = {},
): Promise<ModelReply> {
  switch (cfg.provider) {
    case 'anthropic':
      return callAnthropic(cfg, system, turns, tools, opts);
    case 'openai':
      return callOpenAi(cfg, system, turns, tools, opts);
    case 'gemini':
      return callGemini(cfg, system, turns, tools, opts);
    case 'ollama':
      return callOllama(cfg, system, turns, tools);
  }
}

/** Whether the provider can run web search server-side. */
export function supportsWebSearch(provider: AiProvider, baseUrl?: string): boolean {
  if (provider === 'ollama') return false;
  if (provider === 'openai') return !baseUrl || /api\.openai\.com/.test(baseUrl);
  return true;
}

/**
 * Rough input price per 1M tokens (USD) for the cost estimate shown before
 * sending document content. Matched by substring; Ollama is free. This is an
 * ESTIMATE for the confirmation dialog, not billing.
 */
const PRICE_PER_MTOK: [string, number][] = [
  ['claude-opus', 15],
  ['claude-sonnet', 3],
  ['claude-haiku', 0.8],
  ['gpt-4o-mini', 0.15],
  ['gpt-4o', 2.5],
  ['gpt-4.1-nano', 0.1],
  ['gpt-4.1-mini', 0.4],
  ['gpt-4.1', 2],
  ['gpt-5-mini', 0.25],
  ['gpt-5', 1.25],
  ['o3', 2],
  ['gemini-2.5-flash-lite', 0.1],
  ['gemini-2.5-flash', 0.3],
  ['gemini-2.5-pro', 1.25],
  ['gemini-3-flash', 0.5],
  ['gemini-3-pro', 2],
];

export function estimateUsd(provider: AiProvider, model: string, tokens: number): number | null {
  if (provider === 'ollama') return 0;
  const m = model.toLowerCase();
  const hit = PRICE_PER_MTOK.find(([prefix]) => m.includes(prefix));
  return hit ? (tokens / 1_000_000) * hit[1] : null;
}

// ------------------------------------------------------------- model lists

export interface ModelOption {
  id: string;
  /** Extra context for the picker, e.g. parameter size or a capability note. */
  note?: string;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${res.status} from model API: ${detail}`);
  }
  return res.json();
}

/** OpenAI's /models has no capability metadata — filter to tool-capable chat families. */
const OPENAI_EXCLUDE = /(embed|tts|whisper|audio|realtime|image|dall-e|moderation|transcribe|instruct|davinci|babbage|codex)/i;
const OPENAI_INCLUDE = /^(gpt-|o[0-9]|chatgpt-)/i;

/**
 * List models an admin can pick for the given provider, best-effort filtered
 * to chat models that support tool calling (the agent requires tools).
 * Ollama reports capabilities explicitly; Gemini exposes generation methods;
 * OpenAI/Anthropic are filtered by family.
 */
export async function listModels(cfg: AiProviderConfig): Promise<ModelOption[]> {
  switch (cfg.provider) {
    case 'anthropic': {
      const data = (await getJson(`${cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/models?limit=100`, {
        'x-api-key': cfg.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      })) as { data?: { id: string; display_name?: string }[] };
      return (data.data ?? []).map((m) => ({ id: m.id, note: m.display_name }));
    }
    case 'openai': {
      const data = (await getJson(`${cfg.baseUrl ?? 'https://api.openai.com/v1'}/models`, {
        authorization: `Bearer ${cfg.apiKey ?? ''}`,
      })) as { data?: { id: string }[] };
      return (data.data ?? [])
        .filter((m) => OPENAI_INCLUDE.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
        .sort((a, b) => b.id.localeCompare(a.id))
        .map((m) => ({ id: m.id }));
    }
    case 'gemini': {
      const base = cfg.baseUrl ?? 'https://generativelanguage.googleapis.com';
      const data = (await getJson(`${base}/v1beta/models?pageSize=200`, {
        'x-goog-api-key': cfg.apiKey ?? '',
      })) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
      return (data.models ?? [])
        .filter(
          (m) =>
            m.supportedGenerationMethods?.includes('generateContent') &&
            /gemini/i.test(m.name) &&
            !/(embedding|aqa|image|tts|audio)/i.test(m.name),
        )
        .map((m) => ({ id: m.name.replace(/^models\//, ''), note: m.displayName }));
    }
    case 'ollama': {
      const base = cfg.baseUrl ?? 'http://localhost:11434';
      const tags = (await getJson(`${base}/api/tags`, {})) as {
        models?: { name: string; details?: { parameter_size?: string } }[];
      };
      const out: ModelOption[] = [];
      for (const m of tags.models ?? []) {
        // /api/show reports capabilities on modern Ollama; only keep tool-capable.
        let note = m.details?.parameter_size;
        try {
          const show = (await post(`${base}/api/show`, {}, { model: m.name })) as {
            capabilities?: string[];
          };
          if (show.capabilities && !show.capabilities.includes('tools')) continue;
          if (show.capabilities?.includes('tools')) note = note ? `${note}, tools` : 'tools';
        } catch {
          // Older Ollama without capabilities info: keep the model, unlabelled.
        }
        out.push({ id: m.name, note });
      }
      return out;
    }
  }
}
