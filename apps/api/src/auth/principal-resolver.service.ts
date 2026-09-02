import { Injectable } from '@nestjs/common';
import { ActorType, GlobalRole, type Principal, PrincipalVia } from '@notesetc/shared';
import { GrantRepository } from '../repositories/grant.repository';
import type { ApiTokenRecord } from '../repositories/api-token.repository';
import type { UserRecord } from '../repositories/user.repository';

/** Sentinel id for an anonymous caller. Never a real user; audited as-is (no FK). */
export const ANONYMOUS_USER_ID = 'anonymous';

/**
 * Builds the authorization Principal from a resolved user. This is the single
 * place effective permissions are assembled, so every entry point sees the same
 * principal shape.
 *
 * Grants are resolved from the ResourceGrant ACL — the user's direct grants plus
 * grants held by any group they belong to. Global admins bypass grants in the
 * authorization function, but we still populate them for consistency.
 */
@Injectable()
export class PrincipalResolver {
  constructor(private readonly grants: GrantRepository) {}

  async fromSessionUser(user: UserRecord): Promise<Principal> {
    return {
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole,
      grants: await this.grants.resolveForUser(user.id),
      via: PrincipalVia.Session,
      actorType: 'human',
    };
  }

  /**
   * Principal for a not-signed-in visitor. Holds ONLY the grants of the "Public"
   * system group, so authorization (deny-by-default) permits reading spaces shared
   * publicly and nothing else. Never a global admin; cannot mutate.
   */
  async anonymous(): Promise<Principal> {
    return {
      userId: ANONYMOUS_USER_ID,
      email: 'anonymous',
      globalRole: GlobalRole.Member,
      grants: await this.grants.resolveForAnonymous(),
      via: PrincipalVia.Anonymous,
      actorType: ActorType.Anonymous,
    };
  }

  /**
   * Principal for an API-token caller: the token's owner, tagged as an api_token
   * actor and (optionally) restricted to the token's allowed spaces. The token can
   * never exceed the owner's own permissions — authorization intersects both.
   */
  async fromApiToken(owner: UserRecord, token: ApiTokenRecord): Promise<Principal> {
    return {
      userId: owner.id,
      email: owner.email,
      globalRole: owner.globalRole,
      grants: await this.grants.resolveForUser(owner.id),
      via: PrincipalVia.ApiToken,
      actorType: ActorType.ApiToken,
      tokenId: token.id,
      allowedSpaceIds: token.allowedSpaceIds ?? undefined,
    };
  }
}
