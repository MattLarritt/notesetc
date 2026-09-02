import type { ActorType, AuditResult } from '@notesetc/shared';

/** A single audit record to persist. Append-only — never updated or deleted. */
export interface AuditEntry {
  actorType: ActorType;
  actorUserId?: string;
  actorTokenId?: string;
  aiAgentLabel?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  spaceId?: string;
  result: AuditResult;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  /** Structured detail (e.g. before/after deltas). MUST NOT contain secrets. */
  metadata?: Record<string, unknown>;
}

/**
 * Persistence boundary for the audit log. The service layer depends on this
 * abstract class as a DI token; the concrete implementation (Prisma today,
 * potentially raw MSSQL later) lives behind it. This is the swap point that
 * keeps audit storage portable.
 */
export abstract class AuditRepository {
  abstract append(entry: AuditEntry): Promise<void>;
  /** Read the most recent entries (append-only log), newest first. */
  abstract query(filter: AuditQuery): Promise<AuditRecord[]>;
}

/** A persisted audit row (read side). */
export interface AuditRecord {
  id: string;
  occurredAt: Date;
  actorType: string;
  actorUserId: string | null;
  actorTokenId: string | null;
  aiAgentLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  spaceId: string | null;
  result: string;
  ip: string | null;
  requestId: string | null;
  metadata: string | null;
}

export interface AuditQuery {
  action?: string;
  actorType?: string;
  result?: string;
  spaceId?: string;
  limit?: number;
}
