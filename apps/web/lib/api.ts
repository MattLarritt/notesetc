import 'server-only';
import { cookies } from 'next/headers';

const API_INTERNAL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4100';

export interface Space {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  overview: string | null;
  status: 'active' | 'archived';
  defaultTemplateId?: string | null;
}

export interface TemplateSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  spaceId: string;
  name: string;
  content: string;
  updatedAt: string;
}

export interface ResolvedTemplate {
  templateId: string | null;
  name: string | null;
  content: string;
  source: 'parent' | 'space' | 'default';
}

export async function listTemplates(spaceId: string): Promise<TemplateSummary[]> {
  const res = await apiGet<{ data: TemplateSummary[] }>(`/spaces/${spaceId}/templates`);
  return res?.data ?? [];
}

export async function getTemplate(id: string): Promise<Template | null> {
  return apiGet<Template>(`/templates/${id}`);
}

export async function resolveNewPageTemplate(
  spaceId: string,
  parentId?: string,
): Promise<ResolvedTemplate | null> {
  const q = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
  return apiGet<ResolvedTemplate>(`/spaces/${spaceId}/new-page-template${q}`);
}

export interface Page {
  id: string;
  spaceId: string;
  parentId: string | null;
  slug: string;
  shortId?: string | null;
  title: string;
  icon: string | null;
  status: 'draft' | 'published' | 'archived';
  currentVersionId: string | null;
  position: number;
  updatedAt: string;
  hasChildren?: boolean;
  reviewDueAt?: string | null;
  childTemplateId?: string | null;
  /** Integration metadata (e.g. {"aiChat":{"id":…}}); the API returns it parsed. */
  metadata?: Record<string, unknown> | string | null;
}

export interface PageVersion {
  id: string;
  pageId: string;
  versionNumber: number;
  title: string;
  content: string;
  changeSummary: string | null;
  authorType: string;
  authorUserId: string | null;
  aiAgentLabel: string | null;
  createdAt: string;
}

export interface PageCapabilities {
  edit: boolean;
  propose: boolean;
  createChild: boolean;
  review: boolean;
  manageMaintenance: boolean;
  manageTemplates: boolean;
  delete: boolean;
  comment: boolean;
  moderateComments: boolean;
}

export interface CommentNode {
  id: string;
  parentId: string | null;
  authorType: string;
  authorUserId: string | null;
  authorLabel: string;
  aiAgentLabel: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  resolved: boolean;
  resolvedByLabel: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canResolve: boolean;
  replies: CommentNode[];
}

export interface CommentsView {
  comments: CommentNode[];
  canComment: boolean;
}

export async function getComments(pageId: string): Promise<CommentsView | null> {
  return apiGet<CommentsView>(`/pages/${pageId}/comments`);
}

export type ReviewStatus = 'none' | 'ok' | 'due_soon' | 'overdue';

export interface Maintainer {
  id: string;
  principalType: 'user' | 'group';
  principalId: string;
  label: string;
}

export interface MaintenanceInfo {
  reviewIntervalDays: number | null;
  reviewDueAt: string | null;
  lastReviewedAt: string | null;
  lastReviewedById: string | null;
  lastReviewedByLabel: string | null;
  status: ReviewStatus;
  maintainers: Maintainer[];
  canManage: boolean;
  canReview: boolean;
  isMaintainer: boolean;
  assignable: { users: { id: string; email: string }[]; groups: { id: string; name: string }[] } | null;
}

export async function getMaintenance(pageId: string): Promise<MaintenanceInfo | null> {
  return apiGet<MaintenanceInfo>(`/pages/${pageId}/maintenance`);
}

export interface MyMaintenanceItem {
  id: string;
  title: string;
  shortId?: string | null;
  spaceId: string;
  status: string;
  reviewDueAt: string | null;
  reviewStatus: ReviewStatus;
  lastReviewedAt: string | null;
}

export async function listMyMaintenance(): Promise<MyMaintenanceItem[]> {
  const res = await apiGet<{ data: MyMaintenanceItem[] }>('/maintenance/mine');
  return res?.data ?? [];
}

export interface PageDetail {
  page: Page;
  version: PageVersion | null;
  capabilities: PageCapabilities;
}

export interface Proposal {
  id: string;
  pageId: string;
  baseVersionId: string;
  proposedTitle: string | null;
  proposedContent: string;
  rationale: string | null;
  status: 'open' | 'approved' | 'rejected' | 'superseded';
  originType: string;
  createdById: string | null;
  aiAgentLabel: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Server-side GET against the API, forwarding the caller's session cookie. */
async function apiGet<T>(path: string): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  try {
    const res = await fetch(`${API_INTERNAL}/api/v1${path}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface AiStatus {
  enabled: boolean;
  provider?: string;
  model?: string;
}

export async function getAiStatus(): Promise<AiStatus> {
  return (await apiGet<AiStatus>('/ai/status')) ?? { enabled: false };
}

export async function listSpaces(includeArchived = false): Promise<Space[]> {
  const res = await apiGet<{ data: Space[] }>(
    `/spaces${includeArchived ? '?includeArchived=true' : ''}`,
  );
  return res?.data ?? [];
}

export async function getSpace(id: string): Promise<Space | null> {
  return apiGet<Space>(`/spaces/${id}`);
}

export async function listPages(spaceId: string): Promise<Page[]> {
  const res = await apiGet<{ data: Page[] }>(`/spaces/${spaceId}/pages`);
  return res?.data ?? [];
}

export async function getPage(id: string): Promise<PageDetail | null> {
  return apiGet<PageDetail>(`/pages/${id}`);
}

export async function listVersions(pageId: string): Promise<PageVersion[]> {
  const res = await apiGet<{ data: PageVersion[] }>(`/pages/${pageId}/versions`);
  return res?.data ?? [];
}

export async function listProposals(pageId: string): Promise<Proposal[]> {
  const res = await apiGet<{ data: Proposal[] }>(`/pages/${pageId}/proposals`);
  return res?.data ?? [];
}

export interface SearchResult {
  pageId: string;
  spaceId: string;
  title: string;
  slug: string;
  shortId?: string | null;
  icon: string | null;
  status: 'draft' | 'published' | 'archived';
  snippet: string;
}

export async function searchPages(q: string): Promise<SearchResult[]> {
  const res = await apiGet<{ data: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`);
  return res?.data ?? [];
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  authSource: string;
  globalRole: 'global_admin' | 'member';
  status: 'active' | 'disabled';
  isBreakglass: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export async function listUsers(): Promise<AdminUser[]> {
  const res = await apiGet<{ data: AdminUser[] }>('/admin/users');
  return res?.data ?? [];
}

export interface Grant {
  id: string;
  resourceType: string;
  resourceId: string;
  principalType: 'user' | 'group';
  principalId: string;
  role: 'space_admin' | 'editor' | 'viewer';
  grantedById: string | null;
  createdAt: string;
}

export async function listGrants(spaceId: string): Promise<Grant[]> {
  const res = await apiGet<{ data: Grant[] }>(`/spaces/${spaceId}/grants`);
  return res?.data ?? [];
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  system: boolean;
  kind: 'administrators' | 'all_users' | 'public' | 'custom';
  memberCount: number;
  editableMembers: boolean;
}

export async function listGroups(): Promise<AdminGroup[]> {
  const res = await apiGet<{ data: AdminGroup[] }>('/admin/groups');
  return res?.data ?? [];
}

export interface AdminToken {
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

export async function listTokens(): Promise<AdminToken[]> {
  const res = await apiGet<{ data: AdminToken[] }>('/admin/tokens');
  return res?.data ?? [];
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
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
  metadata: string | null;
}

export async function listAudit(params: {
  action?: string;
  actorType?: string;
  result?: string;
} = {}): Promise<AuditEntry[]> {
  const qs = new URLSearchParams();
  if (params.action) qs.set('action', params.action);
  if (params.actorType) qs.set('actorType', params.actorType);
  if (params.result) qs.set('result', params.result);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiGet<{ data: AuditEntry[] }>(`/admin/audit${suffix}`);
  return res?.data ?? [];
}

// ---- Automations (admin) ----

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: 'page_event' | 'schedule' | 'webhook';
  triggerConfig: Record<string, unknown>;
  script: string;
  timeoutMs: number;
  debugMode: boolean;
  webhookSlug: string | null;
  hasWebhookSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: 'queued' | 'running' | 'success' | 'error' | 'timeout' | 'killed' | 'dead';
  trigger: string;
  triggerPayload: Record<string, unknown> | null;
  dryRun: boolean;
  debug: boolean;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AutomationRunLog {
  seq: number;
  ts: string;
  source: string;
  state: string;
  message: string;
  data: unknown | null;
}

export async function listAutomations(): Promise<Automation[]> {
  const res = await apiGet<{ data: Automation[] }>('/admin/automations');
  return res?.data ?? [];
}

export async function getAutomation(id: string): Promise<Automation | null> {
  return apiGet<Automation>(`/admin/automations/${id}`);
}

export async function listAutomationRuns(params: {
  automationId?: string;
  status?: string;
} = {}): Promise<AutomationRun[]> {
  const qs = new URLSearchParams();
  if (params.automationId) qs.set('automationId', params.automationId);
  if (params.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiGet<{ data: AutomationRun[] }>(`/admin/automations/runs${suffix}`);
  return res?.data ?? [];
}

export async function getAutomationRun(
  runId: string,
): Promise<{ run: AutomationRun; logs: AutomationRunLog[] } | null> {
  return apiGet<{ run: AutomationRun; logs: AutomationRunLog[] }>(
    `/admin/automations/runs/${runId}`,
  );
}
