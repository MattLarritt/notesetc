import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Action, Principal } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { type AuthzResource, decide } from './authorization';

/**
 * Service-layer authorization gate. EVERY service method that performs a
 * protected operation calls `authorize()` before doing work. Because the gate
 * lives here (not in controllers), the REST API, MCP, and web UI are guarded
 * identically and cannot diverge.
 *
 * Denied decisions are audited with result=denied, then surface as 403.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly audit: AuditService) {}

  /** Returns silently if allowed; throws ForbiddenException (and audits) if not. */
  async authorize(
    principal: Principal,
    action: Action,
    resource: AuthzResource,
    ctx?: AuditContext,
  ): Promise<void> {
    const decision = decide(principal, action, resource);
    if (decision.allowed) return;

    await this.audit.recordDenied(
      principal,
      {
        action,
        targetType: resource.type,
        targetId: resource.pageId ?? resource.spaceId,
        spaceId: resource.spaceId,
        metadata: { reason: decision.reason },
      },
      ctx,
    );
    throw new ForbiddenException('You do not have permission to perform this action.');
  }

  /** Non-throwing check for filtering lists (e.g. search scope). */
  can(principal: Principal, action: Action, resource: AuthzResource): boolean {
    return decide(principal, action, resource).allowed;
  }
}
