import type { ResolvedGrant, ResourceRole } from '@notesetc/shared';

export interface GrantRecord {
  id: string;
  resourceType: 'space' | 'page';
  resourceId: string;
  principalType: 'user' | 'group';
  principalId: string;
  role: ResourceRole;
  grantedById: string | null;
  createdAt: Date;
}

export interface CreateGrantInput {
  resourceType: 'space' | 'page';
  resourceId: string;
  principalType: 'user' | 'group';
  principalId: string;
  role: ResourceRole;
  grantedById?: string;
}

/** Persistence boundary for the resource-grant ACL (DI token). */
export abstract class GrantRepository {
  /** All grants on a resource (for the grant-management UI). */
  abstract listForResource(
    resourceType: 'space' | 'page',
    resourceId: string,
  ): Promise<GrantRecord[]>;

  abstract create(input: CreateGrantInput): Promise<GrantRecord>;
  abstract findById(id: string): Promise<GrantRecord | null>;
  abstract updateRole(id: string, role: ResourceRole): Promise<GrantRecord>;
  abstract delete(id: string): Promise<void>;
  /** Remove every grant held by a principal (used when a group is deleted). */
  abstract deleteForPrincipal(principalType: 'user' | 'group', principalId: string): Promise<void>;

  /**
   * Resolve a user's effective grants: their direct (principalType='user') grants
   * plus grants held by any group they belong to (incl. the implicit "All Users"
   * and "Public" system groups). This is what populates the authorization Principal.
   */
  abstract resolveForUser(userId: string): Promise<ResolvedGrant[]>;

  /**
   * Grants available to an anonymous (not-signed-in) caller: only those held by
   * the "Public" system group. Populates the anonymous Principal.
   */
  abstract resolveForAnonymous(): Promise<ResolvedGrant[]>;
}
