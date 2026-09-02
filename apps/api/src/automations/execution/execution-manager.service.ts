import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import { AutomationRunStatus } from '@notesetc/shared';
import {
  type AutomationRecord,
  AutomationRepository,
  type LogEntryInput,
} from '../../repositories/automation.repository';
import { AutomationPrincipalFactory } from './automation-principal';
import { BridgeDispatcher, BridgeError, type DispatchContext } from './bridge-dispatcher.service';
import type { HostMsg, RawLogEntry, TriggerInfo, WorkerInit, WorkerMsg } from './protocol';

export interface RunRequest {
  automation: AutomationRecord;
  trigger: string; // page_event | schedule | webhook | test
  triggerInfo: TriggerInfo;
  /** Force mock mode (test console); otherwise live. */
  dryRun: boolean;
  /** Chain depth (0 for user/external-initiated). */
  depth: number;
}

interface RunHandle {
  runId: string;
  automation: AutomationRecord;
  worker: Worker;
  deadline: NodeJS.Timeout;
  flushTimer: NodeJS.Timeout;
  startedAt: number;
  timeoutMs: number;
  dryRun: boolean;
  depth: number;
  finished: boolean;
  /** Bridge write calls currently executing on the host. */
  inflightWrites: number;
  // log accounting
  seq: number;
  logCount: number;
  logBytes: number;
  logCapped: boolean;
  buffer: LogEntryInput[];
  /** Secure-variable values fetched by this run — redacted from all log output. */
  secrets: Set<string>;
}

const MAX_CONCURRENT = Math.max(1, Number(process.env.AUTOMATIONS_MAX_CONCURRENT ?? 5));
const MAX_QUEUE = 100;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000; // 10 min hard ceiling
const LOG_MAX_ENTRIES = 1_000;
const LOG_MAX_BYTES = 1_000_000;
const LOG_MESSAGE_CAP = 2_000;
const LOG_DATA_CAP = 8_192;
const PERSIST_INTERVAL_MS = 2_000;
const WRITE_METHODS = new Set([
  'pages.create',
  'pages.update',
  'pages.delete',
  'pages.move',
  'pages.setMetadata',
  'pages.publish',
]);

/**
 * Owns the lifecycle of automation runs: one worker_threads Worker per run,
 * bounded concurrency with a FIFO queue, wall-clock timeouts enforced by
 * worker.terminate(), force-stop, buffered log persistence, and dead-run
 * cleanup on startup/shutdown. All script platform access arrives here as
 * bridge messages and is dispatched to the service layer.
 */
@Injectable()
export class ExecutionManagerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Automations');
  private readonly active = new Map<string, RunHandle>();
  private readonly queue: Array<{ runId: string; req: RunRequest }> = [];
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly repo: AutomationRepository,
    private readonly dispatcher: BridgeDispatcher,
    private readonly principals: AutomationPrincipalFactory,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Single-process deployment: any run still queued/running in the DB at boot
    // belonged to a previous process and can never finish.
    const n = await this.repo.markStaleRunsDead('server_restart');
    if (n > 0) this.logger.warn(`Startup sweep: marked ${n} stale run(s) dead.`);
    // Belt-and-braces: catch handles whose timeout timer somehow never fired.
    this.sweepTimer = setInterval(() => this.sweepOverdue(), 60_000);
    this.sweepTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    const handles = [...this.active.values()];
    await Promise.allSettled(handles.map((h) => this.finish(h.runId, AutomationRunStatus.Killed, 'shutdown')));
  }

  /** Number of runs currently executing (for tests/introspection). */
  activeCount(): number {
    return this.active.size;
  }

  /** True if this process is managing the run (executing or waiting in the FIFO). */
  isTracked(runId: string): boolean {
    return this.active.has(runId) || this.queue.some((q) => q.runId === runId);
  }

  /**
   * Create the run row and start it now if a slot is free, else queue it.
   * Returns the runId either way (status is queued until a slot opens).
   */
  async enqueue(req: RunRequest): Promise<string> {
    const run = await this.repo.createRun({
      automationId: req.automation.id,
      trigger: req.trigger,
      triggerPayload: req.triggerInfo as unknown as Record<string, unknown>,
      dryRun: req.dryRun,
      debug: req.automation.debugMode,
    });
    if (this.active.size < MAX_CONCURRENT) {
      await this.start(run.id, req);
    } else if (this.queue.length >= MAX_QUEUE) {
      await this.repo.finishRun(run.id, AutomationRunStatus.Error, 'queue_overflow');
      this.logger.warn(`Run ${run.id} rejected: queue overflow (${MAX_QUEUE}).`);
    } else {
      this.queue.push({ runId: run.id, req });
    }
    return run.id;
  }

  /** Force-stop a running (or queued) run. Returns false if it isn't active. */
  async forceStop(runId: string): Promise<boolean> {
    const queuedIdx = this.queue.findIndex((q) => q.runId === runId);
    if (queuedIdx >= 0) {
      this.queue.splice(queuedIdx, 1);
      await this.repo.finishRun(runId, AutomationRunStatus.Killed, 'stopped_before_start');
      return true;
    }
    if (!this.active.has(runId)) return false;
    await this.finish(runId, AutomationRunStatus.Killed, 'force_stopped');
    return true;
  }

  // ------------------------------------------------------------------ start

  private workerEntry(): string {
    // dist/automations/execution -> dist/automations/runtime/automation.worker.js
    return path.join(__dirname, '..', 'runtime', 'automation.worker.js');
  }

  /** Seam for tests: spawn the actual worker thread. */
  protected spawnWorker(init: WorkerInit): Worker {
    return new Worker(this.workerEntry(), {
      workerData: init,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
  }

  private async start(runId: string, req: RunRequest): Promise<void> {
    const timeoutMs = Math.min(Math.max(req.automation.timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
    let worker: Worker;
    try {
      worker = this.spawnWorker({
        runId,
        code: req.automation.script,
        trigger: req.triggerInfo,
        debug: req.automation.debugMode,
      });
    } catch (err) {
      // e.g. worker file momentarily absent during a watch-mode recompile
      const msg = err instanceof Error ? err.message : String(err);
      await this.repo.finishRun(runId, AutomationRunStatus.Error, `worker_spawn_failed: ${msg}`);
      return;
    }

    const handle: RunHandle = {
      runId,
      automation: req.automation,
      worker,
      startedAt: Date.now(),
      timeoutMs,
      dryRun: req.dryRun,
      depth: req.depth,
      finished: false,
      inflightWrites: 0,
      seq: 0,
      logCount: 0,
      logBytes: 0,
      logCapped: false,
      buffer: [],
      secrets: new Set<string>(),
      deadline: setTimeout(() => void this.finish(runId, AutomationRunStatus.Timeout, `timed out after ${timeoutMs}ms`), timeoutMs),
      flushTimer: setInterval(() => void this.flushLogs(runId), PERSIST_INTERVAL_MS),
    };
    handle.flushTimer.unref();
    this.active.set(runId, handle);
    await this.repo.markRunStarted(runId);

    worker.on('message', (m: WorkerMsg) => void this.onMessage(handle, m));
    worker.on('error', (err) => {
      const msg = String(err?.message ?? err);
      const status = msg.includes('OUT_OF_MEMORY') ? 'out_of_memory' : msg;
      void this.finish(runId, AutomationRunStatus.Error, status);
    });
    worker.on('exit', (code) => void this.onExit(runId, code));
  }

  // --------------------------------------------------------------- messages

  private async onMessage(handle: RunHandle, m: WorkerMsg): Promise<void> {
    if (handle.finished) return; // terminated: ignore stragglers
    switch (m.t) {
      case 'logs':
        for (const raw of m.entries) this.acceptLog(handle, raw);
        return;
      case 'done':
        await this.finish(handle.runId, AutomationRunStatus.Success);
        return;
      case 'failed':
        this.systemLog(handle, 'error', m.error.stack ?? m.error.message);
        await this.finish(handle.runId, AutomationRunStatus.Error, m.error.message);
        return;
      case 'call':
        await this.onBridgeCall(handle, m.callId, m.method, m.args);
        return;
    }
  }

  private async onBridgeCall(
    handle: RunHandle,
    callId: number,
    method: string,
    args: unknown[],
  ): Promise<void> {
    const isWrite = WRITE_METHODS.has(method);
    if (isWrite) handle.inflightWrites++;
    try {
      const principal = await this.principals.forAutomation(handle.automation);
      const ctx: DispatchContext = {
        runId: handle.runId,
        automationId: handle.automation.id,
        principal,
        auditCtx: { requestId: handle.runId },
        dryRun: handle.dryRun,
        depth: handle.depth,
        log: (e) => this.acceptDispatcherLog(handle, e),
        registerSecret: (value) => {
          if (value && value.length >= 4) handle.secrets.add(value);
        },
      };
      const value = await this.dispatcher.dispatch(ctx, method, args);
      this.postToWorker(handle, { t: 'result', callId, ok: true, value });
    } catch (err) {
      const be = err instanceof BridgeError ? err : new BridgeError(String(err), 'internal');
      this.postToWorker(handle, {
        t: 'result',
        callId,
        ok: false,
        error: { message: be.message, code: be.code },
      });
    } finally {
      if (isWrite) handle.inflightWrites--;
    }
  }

  private postToWorker(handle: RunHandle, m: HostMsg): void {
    if (handle.finished) return; // never post to a terminated worker
    try {
      handle.worker.postMessage(m);
    } catch {
      /* worker died between check and post */
    }
  }

  // ------------------------------------------------------------------- logs

  private acceptLog(handle: RunHandle, raw: RawLogEntry): void {
    const state = this.normalizeState(raw);
    const message = this.truncate(
      typeof raw.message === 'string' ? raw.message : JSON.stringify(raw.message ?? ''),
      LOG_MESSAGE_CAP,
    );
    let data: unknown;
    if (raw.data !== undefined && raw.data !== null) {
      const json = this.safeJson(raw.data);
      data = json.length > LOG_DATA_CAP ? `${json.slice(0, LOG_DATA_CAP)}…[truncated]` : raw.data;
      if (typeof data === 'string' && data.endsWith('…[truncated]')) {
        // keep the truncated string form
      }
    }
    this.pushEntry(handle, {
      source: raw.source,
      state,
      message,
      data,
      ts: new Date(raw.at || Date.now()),
    });
  }

  private acceptDispatcherLog(
    handle: RunHandle,
    e: { source: string; state: string; message: string; data?: unknown },
  ): void {
    this.pushEntry(handle, { ...e, ts: new Date() });
  }

  private systemLog(handle: RunHandle, state: string, message: string): void {
    this.pushEntry(handle, {
      source: 'system',
      state,
      message: this.truncate(message, LOG_MESSAGE_CAP),
      ts: new Date(),
    });
  }

  /** Replace any secure-variable value that leaked into text with a mask. */
  private redact(handle: RunHandle, s: string): string {
    let out = s;
    for (const secret of handle.secrets) {
      if (out.includes(secret)) out = out.split(secret).join('***');
    }
    return out;
  }

  private pushEntry(
    handle: RunHandle,
    e: { source: string; state: string; message: string; data?: unknown; ts: Date },
  ): void {
    if (handle.logCapped) return;
    if (handle.secrets.size > 0) {
      e = { ...e, message: this.redact(handle, e.message) };
      if (e.data !== undefined && e.data !== null) {
        const json = this.safeJson(e.data);
        const redacted = this.redact(handle, json);
        if (redacted !== json) {
          try {
            e.data = JSON.parse(redacted);
          } catch {
            e.data = redacted;
          }
        }
      }
    }
    const size = e.message.length + (e.data ? this.safeJson(e.data).length : 0);
    if (handle.logCount + 1 > LOG_MAX_ENTRIES || handle.logBytes + size > LOG_MAX_BYTES) {
      handle.logCapped = true;
      handle.buffer.push({
        seq: handle.seq++,
        ts: new Date(),
        source: 'system',
        state: 'warning',
        message: 'Log limit reached; further output discarded.',
      });
      return;
    }
    handle.logCount++;
    handle.logBytes += size;
    handle.buffer.push({ seq: handle.seq++, ts: e.ts, source: e.source, state: e.state, message: e.message, data: e.data });
  }

  private normalizeState(raw: RawLogEntry): string {
    if (raw.source === 'console') {
      const lvl = raw.level ?? 'log';
      return lvl === 'warn' ? 'warning' : lvl === 'error' ? 'error' : 'info';
    }
    const s = typeof raw.state === 'string' ? raw.state.toLowerCase() : 'info';
    return ['info', 'success', 'warning', 'error'].includes(s) ? s : 'info';
  }

  private truncate(s: string, cap: number): string {
    return s.length > cap ? `${s.slice(0, cap)}…` : s;
  }

  private safeJson(x: unknown): string {
    try {
      return JSON.stringify(x) ?? '';
    } catch {
      return String(x);
    }
  }

  private async flushLogs(runId: string): Promise<void> {
    const handle = this.active.get(runId);
    if (!handle || handle.buffer.length === 0) return;
    const batch = handle.buffer.splice(0);
    try {
      await this.repo.appendLogs(runId, batch);
    } catch (err) {
      this.logger.warn(`Failed to persist ${batch.length} log entries for run ${runId}: ${String(err)}`);
    }
  }

  // ----------------------------------------------------------------- finish

  private async finish(runId: string, status: AutomationRunStatus, error?: string): Promise<void> {
    const handle = this.active.get(runId);
    if (!handle || handle.finished) return;
    handle.finished = true;
    clearTimeout(handle.deadline);
    clearInterval(handle.flushTimer);

    if (handle.inflightWrites > 0 && status !== AutomationRunStatus.Success) {
      this.systemLog(
        handle,
        'warning',
        `${handle.inflightWrites} write(s) were in flight at termination and may have completed.`,
      );
    }

    try {
      await handle.worker.terminate();
    } catch {
      /* already gone */
    }
    await this.flushFinal(handle);
    try {
      await this.repo.finishRun(runId, status, error ?? null);
    } catch (err) {
      this.logger.error(`Failed to finalize run ${runId}: ${String(err)}`);
    }
    this.active.delete(runId);
    void this.dequeueNext();
  }

  private async flushFinal(handle: RunHandle): Promise<void> {
    if (handle.buffer.length === 0) return;
    const batch = handle.buffer.splice(0);
    try {
      await this.repo.appendLogs(handle.runId, batch);
    } catch {
      /* best-effort */
    }
  }

  private async onExit(runId: string, code: number): Promise<void> {
    const handle = this.active.get(runId);
    if (!handle || handle.finished) return;
    // Worker died without done/failed (e.g. resourceLimits OOM kill, process.exit).
    await this.finish(
      runId,
      AutomationRunStatus.Error,
      code === 0 ? 'worker_exited_early' : `worker_exit:${code}`,
    );
  }

  private async dequeueNext(): Promise<void> {
    while (this.queue.length > 0 && this.active.size < MAX_CONCURRENT) {
      const next = this.queue.shift();
      if (!next) return;
      await this.start(next.runId, next.req);
    }
  }

  private sweepOverdue(): void {
    const now = Date.now();
    for (const handle of this.active.values()) {
      if (!handle.finished && now > handle.startedAt + handle.timeoutMs + 5_000) {
        this.logger.warn(`Sweep: run ${handle.runId} exceeded its deadline; forcing timeout.`);
        void this.finish(handle.runId, AutomationRunStatus.Timeout, `swept after ${handle.timeoutMs}ms`);
      }
    }
  }
}
