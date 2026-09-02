import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Action, AuditResult, type Principal, SYSTEM_GROUP } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { GroupRepository } from '../repositories/group.repository';
import { type MaintainerRecord, PageMaintainerRepository } from '../repositories/page-maintainer.repository';
import { type PageRecord, PageRepository } from '../repositories/page.repository';
import { UserRepository } from '../repositories/user.repository';

const DUE_SOON_DAYS = 14;
const DAY_MS = 86_400_000;

export type ReviewStatus = 'none' | 'ok' | 'due_soon' | 'overdue';

export function reviewStatus(dueAt: Date | null): ReviewStatus {
  if (!dueAt) return 'none';
  const now = Date.now();
  if (dueAt.getTime() < now) return 'overdue';
  if (dueAt.getTime() < now + DUE_SOON_DAYS * DAY_MS) return 'due_soon';
  return 'ok';
}

export interface MaintenanceView {
  reviewIntervalDays: number | null;
  reviewDueAt: string | null;
  lastReviewedAt: string | null;
  lastReviewedById: string | null;
  lastReviewedByLabel: string | null;
  status: ReviewStatus;
  /** `label` is a human-readable name resolved server-side (works for any viewer). */
  maintainers: { id: string; principalType: 'user' | 'group'; principalId: string; label: string }[];
  canManage: boolean;
  canReview: boolean;
  isMaintainer: boolean;
  /** Assignable principals — only populated when the caller can manage (space admin+). */
  assignable: { users: { id: string; email: string }[]; groups: { id: string; name: string }[] } | null;
}

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly pages: PageRepository,
    private readonly maintainers: PageMaintainerRepository,
    private readonly groups: GroupRepository,
    private readonly users: UserRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async requirePage(id: string): Promise<PageRecord> {
    const page = await this.pages.findById(id);
    if (!page) throw new NotFoundException('Page not found.');
    return page;
  }

  /** All group ids that make the user an effective maintainer (memberships + All Users). */
  private async effectiveGroupIds(userId: string): Promise<string[]> {
    const ids = await this.groups.listGroupIdsForUser(userId);
    const allUsers = await this.groups.findByName(SYSTEM_GROUP.AllUsers);
    if (allUsers) ids.push(allUsers.id);
    return ids;
  }

  private isMaintainerOf(
    list: MaintainerRecord[],
    userId: string,
    groupIds: string[],
  ): boolean {
    return list.some(
      (m) =>
        (m.principalType === 'user' && m.principalId === userId) ||
        (m.principalType === 'group' && groupIds.includes(m.principalId)),
    );
  }

  async getForPage(principal: Principal, pageId: string, ctx: AuditContext): Promise<MaintenanceView> {
    const page = await this.requirePage(pageId);
    await this.authz.authorize(principal, Action.SpaceRead, { type: 'space', spaceId: page.spaceId }, ctx);

    const list = await this.maintainers.listForPage(pageId);
    const groupIds = await this.effectiveGroupIds(principal.userId);
    const isMaintainer = this.isMaintainerOf(list, principal.userId, groupIds);
    const on = { type: 'space' as const, spaceId: page.spaceId };
    const canManage = this.authz.can(principal, Action.MaintenanceManage, on);
    const canReview = canManage || this.authz.can(principal, Action.PageUpdate, on) || isMaintainer;

    // Resolve display names server-side so any viewer (not just global admins) sees
    // real names rather than raw ids.
    const userIds = list.filter((m) => m.principalType === 'user').map((m) => m.principalId);
    const users = await this.users.findByIds(userIds);
    const userLabel = new Map(users.map((u) => [u.id, u.email]));
    const maintainers: MaintenanceView['maintainers'] = [];
    for (const m of list) {
      let label = m.principalId;
      if (m.principalType === 'user') {
        label = userLabel.get(m.principalId) ?? m.principalId;
      } else {
        const g = await this.groups.findById(m.principalId);
        label = g?.name ?? m.principalId;
      }
      maintainers.push({ id: m.id, principalType: m.principalType, principalId: m.principalId, label });
    }
    let lastReviewedByLabel: string | null = null;
    if (page.lastReviewedById) {
      const u = await this.users.findById(page.lastReviewedById);
      lastReviewedByLabel = u?.email ?? null;
    }

    // Managers need a directory to pick from. Scope it to canManage so it's never
    // exposed to ordinary readers, and so a Space-Admin who isn't a global admin
    // can still assign maintainers without the global-admin-only user/group lists.
    let assignable: MaintenanceView['assignable'] = null;
    if (canManage) {
      const allUsers = await this.users.list();
      const allGroups = await this.groups.list();
      assignable = {
        users: allUsers
          .filter((u) => u.status === 'active')
          .map((u) => ({ id: u.id, email: u.email })),
        // Administrators bypass space grants, so they're not a meaningful maintainer.
        groups: allGroups
          .filter((g) => !(g.system && g.name === SYSTEM_GROUP.Administrators))
          .map((g) => ({ id: g.id, name: g.name })),
      };
    }

    return {
      reviewIntervalDays: page.reviewIntervalDays,
      reviewDueAt: page.reviewDueAt?.toISOString() ?? null,
      lastReviewedAt: page.lastReviewedAt?.toISOString() ?? null,
      lastReviewedById: page.lastReviewedById,
      lastReviewedByLabel,
      status: reviewStatus(page.reviewDueAt),
      maintainers,
      canManage,
      canReview,
      isMaintainer,
      assignable,
    };
  }

  async setSchedule(
    principal: Principal,
    pageId: string,
    input: { intervalDays: number | null; dueAt: string | null },
    ctx: AuditContext,
  ): Promise<PageRecord> {
    const page = await this.requirePage(pageId);
    await this.authz.authorize(principal, Action.MaintenanceManage, { type: 'space', spaceId: page.spaceId }, ctx);

    const interval = input.intervalDays && input.intervalDays > 0 ? Math.floor(input.intervalDays) : null;
    let dueAt: Date | null = null;
    if (input.dueAt) {
      const d = new Date(input.dueAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid review date.');
      dueAt = d;
    } else if (interval && !page.reviewDueAt) {
      dueAt = new Date(Date.now() + interval * DAY_MS);
    } else {
      dueAt = page.reviewDueAt; // keep existing when only the interval changes
    }

    const updated = await this.pages.setReview(pageId, { reviewIntervalDays: interval, reviewDueAt: dueAt });
    await this.audit.record(
      principal,
      {
        action: 'maintenance.schedule',
        result: AuditResult.Success,
        targetType: 'page',
        targetId: pageId,
        spaceId: page.spaceId,
        metadata: { intervalDays: interval, reviewDueAt: dueAt?.toISOString() ?? null },
      },
      ctx,
    );
    return updated;
  }

  async markReviewed(principal: Principal, pageId: string, ctx: AuditContext): Promise<PageRecord> {
    const page = await this.requirePage(pageId);
    const list = await this.maintainers.listForPage(pageId);
    const groupIds = await this.effectiveGroupIds(principal.userId);
    const on = { type: 'space' as const, spaceId: page.spaceId };
    const allowed =
      this.authz.can(principal, Action.MaintenanceManage, on) ||
      this.authz.can(principal, Action.PageUpdate, on) ||
      this.isMaintainerOf(list, principal.userId, groupIds);
    if (!allowed) throw new ForbiddenException('Only a maintainer or editor can mark this reviewed.');

    const now = new Date();
    const nextDue = page.reviewIntervalDays ? new Date(now.getTime() + page.reviewIntervalDays * DAY_MS) : null;
    const updated = await this.pages.markReviewed(pageId, {
      lastReviewedAt: now,
      lastReviewedById: principal.userId,
      reviewDueAt: nextDue,
    });
    await this.audit.record(
      principal,
      {
        action: 'maintenance.reviewed',
        result: AuditResult.Success,
        targetType: 'page',
        targetId: pageId,
        spaceId: page.spaceId,
        metadata: { nextDueAt: nextDue?.toISOString() ?? null },
      },
      ctx,
    );
    return updated;
  }

  async addMaintainer(
    principal: Principal,
    pageId: string,
    input: { principalType: 'user' | 'group'; principalId: string },
    ctx: AuditContext,
  ): Promise<MaintainerRecord> {
    const page = await this.requirePage(pageId);
    await this.authz.authorize(principal, Action.MaintenanceManage, { type: 'space', spaceId: page.spaceId }, ctx);

    if (input.principalType === 'user') {
      if (!(await this.users.findById(input.principalId))) throw new NotFoundException('User not found.');
    } else if (!(await this.groups.findById(input.principalId))) {
      throw new NotFoundException('Group not found.');
    }

    const record = await this.maintainers.create({ pageId, ...input });
    await this.audit.record(
      principal,
      {
        action: 'maintenance.maintainer.add',
        result: AuditResult.Success,
        targetType: 'page',
        targetId: pageId,
        spaceId: page.spaceId,
        metadata: { principalType: input.principalType, principalId: input.principalId },
      },
      ctx,
    );
    return record;
  }

  async removeMaintainer(principal: Principal, pageId: string, maintainerId: string, ctx: AuditContext): Promise<void> {
    const page = await this.requirePage(pageId);
    await this.authz.authorize(principal, Action.MaintenanceManage, { type: 'space', spaceId: page.spaceId }, ctx);
    const record = await this.maintainers.findById(maintainerId);
    if (!record || record.pageId !== pageId) throw new NotFoundException('Maintainer not found on this page.');
    await this.maintainers.delete(maintainerId);
    await this.audit.record(
      principal,
      {
        action: 'maintenance.maintainer.remove',
        result: AuditResult.Success,
        targetType: 'page',
        targetId: pageId,
        spaceId: page.spaceId,
        metadata: { principalType: record.principalType, principalId: record.principalId },
      },
      ctx,
    );
  }

  /** Pages the caller maintains (directly or via a group), readable + not archived, by due date. */
  async mine(principal: Principal): Promise<
    { id: string; title: string; spaceId: string; status: string; reviewDueAt: string | null; reviewStatus: ReviewStatus; lastReviewedAt: string | null }[]
  > {
    const groupIds = await this.effectiveGroupIds(principal.userId);
    const pageIds = await this.maintainers.pageIdsForPrincipals(principal.userId, groupIds);
    const pages = await this.pages.findByIds(pageIds);
    return pages
      .filter((p) => p.status !== 'archived')
      .filter((p) => this.authz.can(principal, Action.SpaceRead, { type: 'space', spaceId: p.spaceId }))
      .map((p) => ({
        id: p.id,
        title: p.title,
        spaceId: p.spaceId,
        status: p.status,
        reviewDueAt: p.reviewDueAt?.toISOString() ?? null,
        reviewStatus: reviewStatus(p.reviewDueAt),
        lastReviewedAt: p.lastReviewedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => {
        if (a.reviewDueAt && b.reviewDueAt) return a.reviewDueAt.localeCompare(b.reviewDueAt);
        if (a.reviewDueAt) return -1;
        if (b.reviewDueAt) return 1;
        return a.title.localeCompare(b.title);
      });
  }
}
