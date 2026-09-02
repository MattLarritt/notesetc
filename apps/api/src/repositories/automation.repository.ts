import type { AutomationRunStatus, AutomationTriggerType } from '@notesetc/shared';

export interface AutomationRecord {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: AutomationTriggerType;
  /** Parsed trigger config (stored as JSON text; never null — empty is {}). */
  triggerConfig: Record<string, unknown>;
  script: string;
  timeoutMs: number;
  debugMode: boolean;
  webhookSlug: string | null;
  /** Present only means "a secret exists"; the hash itself never leaves the repo layer via DTOs. */
  hasWebhookSecret: boolean;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  trigger: string; // page_event | schedule | webhook | test
  triggerPayload: Record<string, unknown> | null;
  dryRun: boolean;
  debug: boolean;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface AutomationRunLogRecord {
  seq: number;
  ts: Date;
  source: string; // netc | console | mock | system
  state: string;
  message: string;
  data: unknown | null;
}

export interface CreateAutomationInput {
  name: string;
  description?: string | null;
  enabled: boolean;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  script: string;
  timeoutMs: number;
  debugMode: boolean;
  webhookSlug?: string | null;
  webhookSecretHash?: string | null;
  createdById: string | null;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  triggerConfig?: Record<string, unknown>;
  script?: string;
  timeoutMs?: number;
  debugMode?: boolean;
  webhookSlug?: string | null;
  webhookSecretHash?: string | null;
  updatedById?: string | null;
}

export interface LogEntryInput {
  seq: number;
  ts: Date;
  source: string;
  state: string;
  message: string;
  data?: unknown;
}

export interface RunListFilter {
  automationId?: string;
  status?: AutomationRunStatus;
  limit?: number;
}

/** Variable scope: the literal 'global', or an automation id (script-scoped). */
export const GLOBAL_VARIABLE_SCOPE = 'global';

export interface AutomationVariableRecord {
  id: string;
  scope: string; // 'global' | <automationId>
  name: string;
  /** Stored form: plaintext, or iv:tag:ciphertext when isSecure. */
  value: string;
  isSecure: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Persistence boundary for automations, their runs, and run logs. */
export abstract class AutomationRepository {
  abstract create(input: CreateAutomationInput): Promise<AutomationRecord>;
  abstract update(id: string, input: UpdateAutomationInput): Promise<AutomationRecord>;
  abstract delete(id: string): Promise<void>;
  abstract findById(id: string): Promise<AutomationRecord | null>;
  abstract findByWebhookSlug(slug: string): Promise<AutomationRecord | null>;
  /** The stored secret hash — only the webhook controller needs it. */
  abstract getWebhookSecretHash(id: string): Promise<string | null>;
  abstract list(): Promise<AutomationRecord[]>;
  abstract listEnabledByTrigger(triggerType: AutomationTriggerType): Promise<AutomationRecord[]>;

  // --- runs ---
  abstract createRun(input: {
    automationId: string;
    trigger: string;
    triggerPayload?: Record<string, unknown> | null;
    dryRun: boolean;
    debug: boolean;
  }): Promise<AutomationRunRecord>;
  abstract markRunStarted(runId: string): Promise<void>;
  abstract finishRun(runId: string, status: AutomationRunStatus, error?: string | null): Promise<void>;
  abstract findRun(runId: string): Promise<AutomationRunRecord | null>;
  abstract listRuns(filter: RunListFilter): Promise<AutomationRunRecord[]>;
  /** True if the automation has a run currently queued or running (cron overlap guard). */
  abstract hasActiveRun(automationId: string): Promise<boolean>;
  /** Mark every queued/running run as dead (startup sweep) or a filtered subset. */
  abstract markStaleRunsDead(reason: string, runIds?: string[]): Promise<number>;
  abstract pruneRunsOlderThan(cutoff: Date): Promise<number>;

  // --- logs ---
  abstract appendLogs(runId: string, entries: LogEntryInput[]): Promise<void>;
  abstract listLogs(runId: string, afterSeq?: number): Promise<AutomationRunLogRecord[]>;

  // --- variables (netc.variable) ---
  abstract listVariables(scope: string): Promise<AutomationVariableRecord[]>;
  abstract findVariable(scope: string, name: string): Promise<AutomationVariableRecord | null>;
  abstract upsertVariable(input: {
    scope: string;
    name: string;
    value: string;
    isSecure: boolean;
    userId: string | null;
  }): Promise<AutomationVariableRecord>;
  abstract deleteVariable(scope: string, name: string): Promise<void>;
  /** Remove all variables scoped to an automation (called when it's deleted). */
  abstract deleteVariablesForScope(scope: string): Promise<void>;
}
