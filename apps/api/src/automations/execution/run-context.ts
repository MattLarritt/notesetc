import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient context for service calls made on behalf of a running automation.
 * The bridge dispatcher wraps every netc.* service call in
 * `automationCallContext.run(...)`; PagesService's event emission reads the
 * store to stamp the loop-guard fields onto the emitted event. This gives
 * per-CALL semantics ({allowTriggers: true} on one write, default on the next)
 * with zero changes to service method signatures.
 */
export interface AutomationCallContext {
  runId: string;
  /** Script opted in to letting THIS write fire other automations. */
  allowTriggers: boolean;
  /** Chain depth: trigger event depth + 1 for the current run. */
  depth: number;
}

export const automationCallContext = new AsyncLocalStorage<AutomationCallContext>();
