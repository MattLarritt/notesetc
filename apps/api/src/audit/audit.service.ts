import { Injectable, Logger } from '@nestjs/common';
import { type ActorType, AuditResult, type Principal } from '@notesetc/shared';
import { AuditRepository } from '../repositories/audit.repository';

/** Request-scoped context captured at the edge for traceability. */
export interface AuditContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuditInput {
  action: string;
  result: AuditResult;
  targetType?: string;
  targetId?: string;
  spaceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Central audit recorder. Every meaningful action — including DENIED ones —
 * flows through here. It derives actor identity from the Principal so callers
 * can't forget the traceability fields.
 *
 * Audit writes are best-effort relative to the request: a logging failure is
 * itself logged loudly but does not crash the user's operation. (A future
 * hardening step may make selected actions fail-closed.)
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repo: AuditRepository) {}

  async record(
    principal: Principal | null,
    input: AuditInput,
    ctx: AuditContext = {},
  ): Promise<void> {
    const actorType: ActorType = principal?.actorType ?? 'system';
    try {
      await this.repo.append({
        actorType,
        actorUserId: principal?.userId,
        actorTokenId: principal?.tokenId,
        aiAgentLabel: principal?.agentLabel,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        spaceId: input.spaceId,
        result: input.result,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: input.metadata,
      });
    } catch (err) {
      // Never let an audit failure swallow the original operation, but make the
      // gap extremely visible.
      this.logger.error(
        `AUDIT WRITE FAILED action=${input.action} result=${input.result} actor=${
          principal?.userId ?? 'system'
        }`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Convenience: record a denied authorization decision. */
  async recordDenied(
    principal: Principal | null,
    input: Omit<AuditInput, 'result'>,
    ctx?: AuditContext,
  ): Promise<void> {
    await this.record(principal, { ...input, result: AuditResult.Denied }, ctx);
  }
}
