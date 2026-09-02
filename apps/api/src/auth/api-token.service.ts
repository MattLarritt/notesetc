import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Action, AuditResult, type Principal } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { type ApiTokenRecord, ApiTokenRepository } from '../repositories/api-token.repository';
import { UserRepository } from '../repositories/user.repository';
import { PasswordService } from './password.service';
import { PrincipalResolver } from './principal-resolver.service';

/** Public metadata for a token (never includes the secret or its hash). */
export interface TokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  ownerUserId: string;
  allowedSpaceIds: string[] | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateTokenInput {
  name: string;
  ownerUserId?: string;
  allowedSpaceIds?: string[];
  expiresInDays?: number;
}

const PREFIX = 'netck';

function summarize(t: ApiTokenRecord): TokenSummary {
  return {
    id: t.id,
    name: t.name,
    tokenPrefix: t.tokenPrefix,
    ownerUserId: t.ownerUserId,
    allowedSpaceIds: t.allowedSpaceIds,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * API-token lifecycle + bearer resolution. Tokens look like `netck_<prefix>_<secret>`
 * — only the prefix is stored in the clear (for fast lookup); the secret is
 * argon2id-hashed like a password and shown to the user exactly once.
 */
@Injectable()
export class ApiTokenService {
  constructor(
    private readonly tokens: ApiTokenRepository,
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly resolver: PrincipalResolver,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve a raw bearer token to a Principal, or null if invalid/expired/revoked. */
  async resolvePrincipal(raw: string): Promise<Principal | null> {
    // Format: netck_<prefix>_<secret>. The prefix is hex (no underscore), but the
    // secret is base64url and MAY contain '_', so split only on the first two
    // underscores and treat the remainder as the secret.
    const parts = raw.trim().split('_');
    if (parts.length < 3 || parts[0] !== PREFIX) return null;
    const prefix = parts[1];
    const secret = parts.slice(2).join('_');

    const token = await this.tokens.findByPrefix(prefix);
    if (!token || token.revokedAt) return null;
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;

    const ok = await this.passwords.verify(token.tokenHash, secret);
    if (!ok) return null;

    const owner = await this.users.findById(token.ownerUserId);
    if (!owner || owner.status === 'disabled') return null;

    void this.tokens.touchLastUsed(token.id, new Date()).catch(() => undefined);
    return this.resolver.fromApiToken(owner, token);
  }

  async create(
    principal: Principal,
    dto: CreateTokenInput,
    ctx: AuditContext,
  ): Promise<TokenSummary & { token: string }> {
    await this.authz.authorize(principal, Action.AdminTokens, { type: 'global' }, ctx);

    const ownerUserId = dto.ownerUserId ?? principal.userId;
    const owner = await this.users.findById(ownerUserId);
    if (!owner) throw new NotFoundException('Token owner not found.');

    const prefix = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await this.passwords.hash(secret);
    const expiresAt =
      dto.expiresInDays && dto.expiresInDays > 0
        ? new Date(Date.now() + dto.expiresInDays * 86_400_000)
        : null;

    const record = await this.tokens.create({
      name: dto.name,
      tokenHash,
      tokenPrefix: prefix,
      ownerUserId,
      allowedSpaceIds: dto.allowedSpaceIds && dto.allowedSpaceIds.length ? dto.allowedSpaceIds : null,
      expiresAt,
    });

    await this.audit.record(
      principal,
      {
        action: 'token.create',
        result: AuditResult.Success,
        targetType: 'api_token',
        targetId: record.id,
        metadata: { name: dto.name, ownerUserId, allowedSpaceIds: record.allowedSpaceIds, expiresAt: expiresAt?.toISOString() ?? null },
      },
      ctx,
    );

    // The full token is returned exactly once — it is never recoverable after this.
    return { ...summarize(record), token: `${PREFIX}_${prefix}_${secret}` };
  }

  async list(principal: Principal, ctx: AuditContext): Promise<TokenSummary[]> {
    await this.authz.authorize(principal, Action.AdminTokens, { type: 'global' }, ctx);
    return (await this.tokens.list()).map(summarize);
  }

  /**
   * Rotate a token in place: new prefix + secret, same id/name/owner/scopes/
   * expiry. The old credential stops working immediately; the new full token
   * is returned exactly once.
   */
  async rotate(
    principal: Principal,
    id: string,
    ctx: AuditContext,
  ): Promise<TokenSummary & { token: string }> {
    await this.authz.authorize(principal, Action.AdminTokens, { type: 'global' }, ctx);
    const record = await this.tokens.findById(id);
    if (!record) throw new NotFoundException('Token not found.');
    if (record.revokedAt) throw new BadRequestException('Token is revoked — create a new one instead.');

    const prefix = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await this.passwords.hash(secret);
    await this.tokens.updateSecret(id, tokenHash, prefix);

    await this.audit.record(
      principal,
      {
        action: 'token.rotate',
        result: AuditResult.Success,
        targetType: 'api_token',
        targetId: id,
        metadata: { name: record.name, oldPrefix: record.tokenPrefix, newPrefix: prefix },
      },
      ctx,
    );

    const updated = (await this.tokens.findById(id))!;
    return { ...summarize(updated), token: `${PREFIX}_${prefix}_${secret}` };
  }

  async revoke(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
    await this.authz.authorize(principal, Action.AdminTokens, { type: 'global' }, ctx);
    const token = await this.tokens.findById(id);
    if (!token) throw new NotFoundException('Token not found.');
    if (!token.revokedAt) await this.tokens.revoke(id, new Date());
    await this.audit.record(
      principal,
      { action: 'token.revoke', result: AuditResult.Success, targetType: 'api_token', targetId: id, metadata: { name: token.name } },
      ctx,
    );
  }
}
