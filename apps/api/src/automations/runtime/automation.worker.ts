/**
 * Sandbox worker for one automation run.
 *
 * IMPORTANT: this file (and anything it imports at runtime) must use Node
 * builtins ONLY — never Nest, Prisma, or other src/ modules. It compiles 1:1 to
 * dist/automations/runtime/automation.worker.js and is spawned as a plain
 * worker_threads entry; all platform access flows over the postMessage bridge
 * to the host, which calls the real service layer (authz + audit included).
 * `protocol.ts` is types-only, so its import erases at compile time.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { HostMsg, RawLogEntry, WorkerInit, WorkerMsg } from '../execution/protocol';
import { LOG_FLUSH_BATCH, LOG_FLUSH_INTERVAL_MS } from '../execution/protocol';

const port = parentPort;
if (!port) throw new Error('automation.worker must be spawned as a worker thread');
const init = workerData as WorkerInit;

const post = (m: WorkerMsg) => port.postMessage(m);

// ---- RPC to the host ----------------------------------------------------
let nextCallId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function call(method: string, ...args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = nextCallId++;
    pending.set(callId, { resolve, reject });
    post({ t: 'call', callId, method, args });
  });
}

port.on('message', (m: HostMsg) => {
  if (m.t !== 'result') return;
  const p = pending.get(m.callId);
  if (!p) return;
  pending.delete(m.callId);
  if (m.ok) p.resolve(m.value);
  else p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
});

// ---- log batching --------------------------------------------------------
const logBuf: RawLogEntry[] = [];
function flushLogs(): void {
  if (logBuf.length) post({ t: 'logs', entries: logBuf.splice(0) });
}
setInterval(flushLogs, LOG_FLUSH_INTERVAL_MS).unref();
function pushLog(e: RawLogEntry): void {
  logBuf.push(e);
  if (logBuf.length >= LOG_FLUSH_BATCH) flushLogs();
}

function toText(x: unknown): string {
  if (typeof x === 'string') return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

// ---- the `netc` API the script sees ----------------------------------------
const netc = {
  trigger: init.trigger,
  log(entry: { state?: string; message?: unknown; data?: unknown } | string) {
    const e = typeof entry === 'string' ? { message: entry } : (entry ?? {});
    pushLog({ source: 'netc', at: Date.now(), state: e.state, message: e.message, data: e.data });
  },
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, Number(ms) || 0))),
  fetch: (url: string, opts?: object) => call('fetch', url, opts),
  /** Read a named variable (plain or secure). Secure values are auto-redacted from logs. */
  variable: (name: string) => call('variable.get', name),
  pages: {
    get: (id: string) => call('pages.get', id),
    children: (id: string) => call('pages.children', id),
    findByPath: (spaceKey: string, path: string) => call('pages.findByPath', spaceKey, path),
    create: (input: object, opts?: object) => call('pages.create', input, opts),
    update: (id: string, data: object, opts?: object) => call('pages.update', id, data, opts),
    delete: (id: string, opts?: object) => call('pages.delete', id, opts),
    publish: (id: string, opts?: object) => call('pages.publish', id, opts),
    move: (id: string, dto: object, opts?: object) => call('pages.move', id, dto, opts),
    setMetadata: (id: string, value: object, opts?: object) =>
      call('pages.setMetadata', id, value, opts),
  },
  spaces: {
    list: () => call('spaces.list'),
  },
};

// console.* is captured only in debug mode; otherwise a silent no-op so noisy
// scripts don't bloat run logs.
const consoleProxy: Record<string, (...a: unknown[]) => void> = {};
for (const lvl of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
  consoleProxy[lvl] = (...a: unknown[]) => {
    if (!init.debug) return;
    pushLog({ source: 'console', level: lvl, at: Date.now(), message: a.map(toText).join(' ') });
  };
}

// ---- run the user script --------------------------------------------------
(async () => {
  // AsyncFunction so plain top-level `await netc.pages.get(...)` works.
  const AsyncFunction = Object.getPrototypeOf(async function () {
    /* */
  }).constructor as new (...args: string[]) => (...fnArgs: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction('netc', 'console', `"use strict";\n${init.code}`);
  await fn(netc, consoleProxy);
  flushLogs();
  post({ t: 'done' });
})().catch((err: unknown) => {
  flushLogs();
  const e = err as { message?: unknown; stack?: string } | undefined;
  post({
    t: 'failed',
    error: { message: String(e?.message ?? err), stack: typeof e?.stack === 'string' ? e.stack : undefined },
  });
});
