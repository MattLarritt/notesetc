/**
 * Message protocol between the host (ExecutionManager) and the sandbox worker
 * (runtime/automation.worker.ts). Imported by BOTH sides — keep this file
 * types-only (plus tiny constants) so the compiled worker stays dependency-free.
 */

/** What the script sees as `netc.trigger`. */
export interface TriggerInfo {
  type:
    | 'page.created'
    | 'page.updated'
    | 'page.moved'
    | 'page.deleted'
    | 'cron'
    | 'webhook'
    | 'manual';
  pageId?: string;
  spaceId?: string;
  title?: string;
  slug?: string;
  updateKind?: string;
  move?: unknown;
  deletedPageIds?: string[];
  actor?: { type: string; userId?: string; label?: string };
  webhook?: { method: string; headers: Record<string, string>; query: Record<string, string>; body: unknown };
  firedAt: string;
}

export interface RawLogEntry {
  source: 'netc' | 'console';
  at: number;
  state?: string;
  level?: string;
  message?: unknown;
  data?: unknown;
}

/** Payload the worker is spawned with (workerData). */
export interface WorkerInit {
  runId: string;
  code: string;
  trigger: TriggerInfo;
  debug: boolean;
}

/** worker -> host */
export type WorkerMsg =
  | { t: 'call'; callId: number; method: string; args: unknown[] }
  | { t: 'logs'; entries: RawLogEntry[] }
  | { t: 'done' }
  | { t: 'failed'; error: { message: string; stack?: string } };

/** host -> worker */
export type HostMsg =
  | { t: 'result'; callId: number; ok: true; value: unknown }
  | { t: 'result'; callId: number; ok: false; error: { message: string; code?: string } };

export const LOG_FLUSH_INTERVAL_MS = 500;
export const LOG_FLUSH_BATCH = 50;
