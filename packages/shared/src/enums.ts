/**
 * Core domain vocabulary for Notes Etc.
 * These enums are the single source of truth shared by the API, web UI, and MCP.
 */

/** Where an identity originates. */
export const AuthSource = {
  Local: 'local',
  Entra: 'entra',
} as const;
export type AuthSource = (typeof AuthSource)[keyof typeof AuthSource];

/** Global (system-wide) role on a user. */
export const GlobalRole = {
  GlobalAdmin: 'global_admin',
  Member: 'member',
} as const;
export type GlobalRole = (typeof GlobalRole)[keyof typeof GlobalRole];

/** Roles granted on a resource (space today; page later). */
export const ResourceRole = {
  SpaceAdmin: 'space_admin',
  Editor: 'editor',
  Viewer: 'viewer',
} as const;
export type ResourceRole = (typeof ResourceRole)[keyof typeof ResourceRole];

/** What kind of resource a grant or permission check targets. */
export const ResourceType = {
  Space: 'space',
  Page: 'page',
} as const;
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

/** Who/what performed an action — the traceability dimension. */
export const ActorType = {
  Human: 'human',
  ApiToken: 'api_token',
  AiTool: 'ai_tool',
  System: 'system',
  Anonymous: 'anonymous',
  Automation: 'automation',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

/** How a request reached the service layer. */
export const PrincipalVia = {
  Session: 'session',
  ApiToken: 'api_token',
  Mcp: 'mcp',
  Anonymous: 'anonymous',
  Automation: 'automation',
} as const;
export type PrincipalVia = (typeof PrincipalVia)[keyof typeof PrincipalVia];

export const PageStatus = {
  Draft: 'draft',
  Published: 'published',
  Archived: 'archived',
} as const;
export type PageStatus = (typeof PageStatus)[keyof typeof PageStatus];

export const ProposalStatus = {
  Open: 'open',
  Approved: 'approved',
  Rejected: 'rejected',
  Superseded: 'superseded',
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const AuditResult = {
  Success: 'success',
  Denied: 'denied',
  Error: 'error',
} as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];

/**
 * Actions are the verbs `authorize()` checks. Naming: `<resource>.<verb>`.
 * Keep this list aligned with the capability matrix in docs/DESIGN.md §3.4.
 */
export const Action = {
  SpaceRead: 'space.read',
  SpaceCreate: 'space.create',
  SpaceUpdate: 'space.update',
  SpaceArchive: 'space.archive',
  SpaceManageGrants: 'space.grants.manage',
  PageReadPublished: 'page.read.published',
  PageReadDraft: 'page.read.draft',
  PageCreate: 'page.create',
  PageUpdate: 'page.update',
  PagePublish: 'page.publish',
  PageArchive: 'page.archive',
  PageDelete: 'page.delete',
  PageReorganize: 'page.reorganize',
  MaintenanceManage: 'page.maintenance.manage',
  TemplateManage: 'template.manage',
  CommentCreate: 'comment.create',
  CommentModerate: 'comment.moderate',
  ProposalCreate: 'proposal.create',
  ProposalReview: 'proposal.review',
  VersionRead: 'version.read',
  VersionRestore: 'version.restore',
  AttachmentUpload: 'attachment.upload',
  AttachmentRead: 'attachment.read',
  Search: 'search',
  AdminUsers: 'admin.users',
  AdminGroups: 'admin.groups',
  AdminTokens: 'admin.tokens',
  AdminAuthConfig: 'admin.auth_config',
  AdminAuditRead: 'admin.audit.read',
  AdminSettings: 'admin.settings',
  AdminAutomations: 'admin.automations.manage',
} as const;
export type Action = (typeof Action)[keyof typeof Action];

/** What fires an automation. */
export const AutomationTriggerType = {
  PageEvent: 'page_event',
  Schedule: 'schedule',
  Webhook: 'webhook',
} as const;
export type AutomationTriggerType =
  (typeof AutomationTriggerType)[keyof typeof AutomationTriggerType];

/** Lifecycle of one automation execution. */
export const AutomationRunStatus = {
  Queued: 'queued',
  Running: 'running',
  Success: 'success',
  Error: 'error',
  Timeout: 'timeout',
  Killed: 'killed',
  Dead: 'dead',
} as const;
export type AutomationRunStatus =
  (typeof AutomationRunStatus)[keyof typeof AutomationRunStatus];

/** Page mutations that can fire page_event automations. */
export const PageEventType = {
  Created: 'page.created',
  Updated: 'page.updated',
  Moved: 'page.moved',
  Deleted: 'page.deleted',
} as const;
export type PageEventType = (typeof PageEventType)[keyof typeof PageEventType];

/** Canonical stored content format identifier (Notes Etc Flavored Markdown). */
export const CONTENT_FORMAT = 'hfm/1' as const;

/**
 * The seeded, non-deletable system groups. "Administrators" is a view over
 * global-admins (membership ⇔ globalRole=global_admin); "All Users" is implicit —
 * every authenticated user belongs, so its space grants apply to everyone signed
 * in; "Public" is broader still — its grants apply to EVERYONE, including
 * anonymous (not-signed-in) visitors. Nobody is a member of Public; it's how a
 * space is shared publicly. Users cannot be assigned to it.
 */
export const SYSTEM_GROUP = {
  Administrators: 'Administrators',
  AllUsers: 'All Users',
  Public: 'Public',
} as const;
export type SystemGroupName = (typeof SYSTEM_GROUP)[keyof typeof SYSTEM_GROUP];
