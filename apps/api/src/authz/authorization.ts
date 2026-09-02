import { Action, type Principal, ResourceRole } from '@notesetc/shared';

/**
 * The target of a permission check. For page actions, pass the page's spaceId so
 * the hierarchy can resolve (page -> space -> global). When page-level grants are
 * added later, this gains an optional pageId and the resolver walks page grants
 * first — no call-site changes required.
 */
export interface AuthzResource {
  type: 'global' | 'space' | 'page';
  spaceId?: string;
  pageId?: string;
}

/** Ordering so "at least editor" style checks are simple comparisons. */
const ROLE_RANK: Record<ResourceRole, number> = {
  [ResourceRole.Viewer]: 1,
  [ResourceRole.Editor]: 2,
  [ResourceRole.SpaceAdmin]: 3,
};

/** Actions that only a global admin may perform (no space scope). */
const GLOBAL_ONLY = new Set<string>([
  Action.SpaceCreate,
  Action.AdminUsers,
  Action.AdminGroups,
  Action.AdminTokens,
  Action.AdminAuthConfig,
  Action.AdminAuditRead,
  Action.AdminSettings,
  Action.AdminAutomations,
]);

/**
 * Minimum space role required per action. Mirrors the capability matrix in
 * DESIGN §3.4. ProposalCreate defaults to editor; a per-space setting may later
 * lower it to viewer.
 */
const MIN_SPACE_ROLE: Record<string, ResourceRole> = {
  [Action.SpaceRead]: ResourceRole.Viewer,
  [Action.PageReadPublished]: ResourceRole.Viewer,
  [Action.VersionRead]: ResourceRole.Viewer,
  [Action.AttachmentRead]: ResourceRole.Viewer,
  [Action.Search]: ResourceRole.Viewer,
  [Action.PageReadDraft]: ResourceRole.Editor,
  [Action.PageCreate]: ResourceRole.Editor,
  [Action.PageUpdate]: ResourceRole.Editor,
  [Action.PagePublish]: ResourceRole.Editor,
  [Action.PageArchive]: ResourceRole.Editor,
  [Action.ProposalCreate]: ResourceRole.Editor,
  [Action.ProposalReview]: ResourceRole.Editor,
  [Action.CommentCreate]: ResourceRole.Editor,
  [Action.VersionRestore]: ResourceRole.Editor,
  [Action.AttachmentUpload]: ResourceRole.Editor,
  [Action.PageReorganize]: ResourceRole.SpaceAdmin,
  [Action.PageDelete]: ResourceRole.SpaceAdmin,
  [Action.CommentModerate]: ResourceRole.SpaceAdmin,
  [Action.MaintenanceManage]: ResourceRole.SpaceAdmin,
  [Action.TemplateManage]: ResourceRole.SpaceAdmin,
  [Action.SpaceUpdate]: ResourceRole.SpaceAdmin,
  [Action.SpaceArchive]: ResourceRole.SpaceAdmin,
  [Action.SpaceManageGrants]: ResourceRole.SpaceAdmin,
};

/** The highest role the principal holds on the given space (direct or group). */
export function effectiveSpaceRole(
  principal: Principal,
  spaceId: string | undefined,
): ResourceRole | null {
  if (!spaceId) return null;
  let best: ResourceRole | null = null;
  for (const grant of principal.grants) {
    if (grant.resourceType === 'space' && grant.resourceId === spaceId) {
      if (!best || ROLE_RANK[grant.role] > ROLE_RANK[best]) best = grant.role;
    }
  }
  return best;
}

export interface AuthzDecision {
  allowed: boolean;
  reason: string;
}

/**
 * The single authorization decision function. Pure and deny-by-default: every
 * path that does not explicitly grant access returns `allowed: false`.
 *
 * Token scoping: a token-restricted principal (allowedSpaceIds) can never act
 * outside those spaces, even if its owner could.
 */
export function decide(
  principal: Principal,
  action: Action,
  resource: AuthzResource,
): AuthzDecision {
  // Global admin bypasses space checks — but token space restrictions still apply.
  const isGlobalAdmin = principal.globalRole === 'global_admin';

  // Enforce token space restriction up front for any space/page-scoped action.
  if (resource.spaceId && principal.allowedSpaceIds) {
    if (!principal.allowedSpaceIds.includes(resource.spaceId)) {
      return { allowed: false, reason: 'token not scoped to this space' };
    }
  }

  if (GLOBAL_ONLY.has(action)) {
    return isGlobalAdmin
      ? { allowed: true, reason: 'global_admin' }
      : { allowed: false, reason: 'requires global_admin' };
  }

  if (isGlobalAdmin) {
    return { allowed: true, reason: 'global_admin' };
  }

  const required = MIN_SPACE_ROLE[action];
  if (!required) {
    // Unknown action => deny by default.
    return { allowed: false, reason: `no rule for action ${action}` };
  }

  const role = effectiveSpaceRole(principal, resource.spaceId);
  if (!role) {
    return { allowed: false, reason: 'no role on space' };
  }

  if (ROLE_RANK[role] >= ROLE_RANK[required]) {
    return { allowed: true, reason: `role ${role} satisfies ${required}` };
  }
  return { allowed: false, reason: `role ${role} below required ${required}` };
}
