import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Action,
  AuditResult,
  CONTENT_FORMAT,
  PageEventType,
  PageStatus,
  type Principal,
} from '@notesetc/shared';
import { automationCallContext } from '../automations/execution/run-context';
import type { PageEvent } from '../automations/page-events';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { PageVersionRepository } from '../repositories/page-version.repository';
import {
  type PageRecord,
  PageRepository,
  type PageVersionRecord,
  type VersionAuthor,
} from '../repositories/page.repository';
import { SpaceRepository } from '../repositories/space.repository';
import { slugify } from '../common/slug';
import { generateShortId } from '../common/short-id';
import type { CreatePageDto, UpdatePageDto } from './dto';

/** What the acting principal may do with this page (drives which UI actions show). */
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

export interface PageDetail {
  page: PageRecord;
  version: PageVersionRecord | null;
  capabilities: PageCapabilities;
}

/** Map the acting principal onto version author-traceability fields. */
function authorOf(principal: Principal): VersionAuthor {
  return {
    authorType: principal.actorType,
    authorUserId: principal.userId,
    authorTokenId: principal.tokenId ?? null,
    aiAgentLabel: principal.agentLabel ?? null,
  };
}

/**
 * Page + version operations. Every edit appends a new immutable version and
 * moves the page's current pointer (transactionally, in the repository). Reads
 * are gated by page status: published => viewer+, draft/archived => editor+.
 */
@Injectable()
export class PagesService {
  constructor(
    private readonly pages: PageRepository,
    private readonly versions: PageVersionRepository,
    private readonly spaces: SpaceRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Emit a page event for automations, AFTER the write + audit succeeded.
   * Loop-guard fields come from the ambient automation run context (set by the
   * netc bridge dispatcher): a write from an automation is suppressed unless
   * that call opted in with {allowTriggers: true}. Listeners run detached, so
   * this can never break a mutation.
   */
  private emitPageEvent(
    principal: Principal,
    event: Omit<PageEvent, 'actor' | 'suppressAutomations' | 'automationDepth' | 'occurredAt'>,
  ): void {
    const auto = automationCallContext.getStore();
    const payload: PageEvent = {
      ...event,
      actor: {
        type: principal.actorType,
        userId: principal.userId,
        label: principal.agentLabel,
      },
      suppressAutomations: auto ? !auto.allowTriggers : false,
      automationDepth: auto ? auto.depth + 1 : 0,
      occurredAt: new Date().toISOString(),
    };
    try {
      this.events.emit(event.type, payload);
    } catch {
      /* never let event fan-out break the mutation */
    }
  }

  // ---- reads ----

  /**
   * List pages in a space; drafts/archived are hidden from viewers.
   * `parentFilter` enables lazy tree loading:
   *   - undefined  -> all pages in the space (flat)
   *   - 'root'     -> only top-level pages (parentId === null)
   *   - <pageId>   -> only direct children of that page
   */
  async list(
    principal: Principal,
    spaceId: string,
    ctx: AuditContext,
    parentFilter?: string,
  ): Promise<(PageRecord & { hasChildren: boolean })[]> {
    await this.authz.authorize(principal, Action.SpaceRead, { type: 'space', spaceId }, ctx);
    const canSeeDrafts = this.authz.can(principal, Action.PageReadDraft, {
      type: 'space',
      spaceId,
    });
    let all = await this.pages.listBySpace(spaceId);
    if (!canSeeDrafts) all = all.filter((p) => p.status === PageStatus.Published);

    // Which pages are a parent of at least one (readable) page — powers the
    // sidebar's "only show an expander when there are subpages".
    const parentIds = new Set(all.map((p) => p.parentId).filter((id): id is string => id !== null));

    let result = all;
    if (parentFilter === 'root') {
      result = all.filter((p) => p.parentId === null);
    } else if (parentFilter !== undefined) {
      result = all.filter((p) => p.parentId === parentFilter);
    }
    return result.map((p) => ({ ...p, hasChildren: parentIds.has(p.id) }));
  }

  async getById(principal: Principal, idOrCode: string, ctx: AuditContext): Promise<PageDetail> {
    const page = await this.requirePageRef(idOrCode);
    await this.authorizeRead(principal, page, ctx);
    const version = page.currentVersionId
      ? await this.versions.findById(page.currentVersionId)
      : null;
    return { page, version, capabilities: this.capabilitiesFor(principal, page.spaceId) };
  }

  /** Compute the caller's capabilities on a page's space (for read-only UI gating). */
  private capabilitiesFor(principal: Principal, spaceId: string): PageCapabilities {
    const on = { type: 'space' as const, spaceId };
    return {
      edit: this.authz.can(principal, Action.PageUpdate, on),
      propose: this.authz.can(principal, Action.ProposalCreate, on),
      createChild: this.authz.can(principal, Action.PageCreate, on),
      review: this.authz.can(principal, Action.ProposalReview, on),
      manageMaintenance: this.authz.can(principal, Action.MaintenanceManage, on),
      manageTemplates: this.authz.can(principal, Action.TemplateManage, on),
      delete: this.authz.can(principal, Action.PageDelete, on),
      comment: this.authz.can(principal, Action.CommentCreate, on),
      moderateComments: this.authz.can(principal, Action.CommentModerate, on),
    };
  }

  async getByPath(
    principal: Principal,
    spaceKey: string,
    path: string,
    ctx: AuditContext,
  ): Promise<PageDetail> {
    const space = await this.spaces.findByKey(spaceKey);
    if (!space) throw new NotFoundException('Space not found.');
    const slugs = path.split('/').map((s) => s.trim()).filter(Boolean);
    if (!slugs.length) throw new NotFoundException('Empty page path.');
    const page = await this.pages.resolveByPath(space.id, slugs);
    if (!page) throw new NotFoundException('Page not found at that path.');
    return this.getById(principal, page.id, ctx);
  }

  async listVersions(
    principal: Principal,
    pageId: string,
    ctx: AuditContext,
  ): Promise<PageVersionRecord[]> {
    const page = await this.requirePage(pageId);
    await this.authorizeRead(principal, page, ctx);
    return this.versions.listByPage(pageId);
  }

  async getVersion(
    principal: Principal,
    versionId: string,
    ctx: AuditContext,
  ): Promise<PageVersionRecord> {
    const version = await this.versions.findById(versionId);
    if (!version) throw new NotFoundException('Version not found.');
    const page = await this.requirePage(version.pageId);
    await this.authorizeRead(principal, page, ctx);
    return version;
  }

  // ---- writes ----

  async create(
    principal: Principal,
    spaceId: string,
    dto: CreatePageDto,
    ctx: AuditContext,
  ): Promise<PageDetail> {
    await this.authz.authorize(principal, Action.PageCreate, { type: 'space', spaceId }, ctx);

    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.requirePage(dto.parentId);
      if (parent.spaceId !== spaceId) {
        throw new ConflictException('Parent page belongs to a different space.');
      }
      parentId = parent.id;
    }

    const slug = dto.slug ?? slugify(dto.title);
    if (await this.pages.findBySlug(spaceId, parentId, slug)) {
      throw new ConflictException(`A page with slug "${slug}" already exists here.`);
    }

    const position = await this.pages.countSiblings(spaceId, parentId);
    // A short, stable public code for pretty URLs. Pre-check for a free one; the
    // DB unique index is the real backstop against the (vanishingly rare) clash.
    let shortId = generateShortId();
    for (let i = 0; i < 5 && (await this.pages.findByShortId(shortId)); i += 1) {
      shortId = generateShortId();
    }
    const { page, version } = await this.pages.create({
      spaceId,
      parentId,
      slug,
      shortId,
      title: dto.title,
      icon: dto.icon,
      ownerId: principal.userId,
      createdById: principal.userId,
      position,
      content: dto.content,
      contentFormat: CONTENT_FORMAT,
      changeSummary: dto.changeSummary ?? 'Created',
      author: authorOf(principal),
    });

    await this.auditWrite(principal, Action.PageCreate, page, ctx, {
      slug,
      title: page.title,
      versionNumber: version.versionNumber,
    });
    this.emitPageEvent(principal, {
      type: PageEventType.Created,
      pageId: page.id,
      spaceId: page.spaceId,
      title: page.title,
      slug: page.slug,
    });
    return { page, version, capabilities: this.capabilitiesFor(principal, page.spaceId) };
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdatePageDto,
    ctx: AuditContext,
  ): Promise<PageDetail> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PageUpdate,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );

    // Optimistic concurrency: reject if the base version is no longer current.
    const current = page.currentVersionId
      ? await this.versions.findById(page.currentVersionId)
      : null;
    if (current && dto.baseVersionNumber !== current.versionNumber) {
      throw new ConflictException(
        `Stale edit: base version ${dto.baseVersionNumber} is not the current version ${current.versionNumber}.`,
      );
    }

    const { page: updated, version } = await this.pages.addRevision(id, {
      title: dto.title ?? page.title,
      content: dto.content ?? current?.content ?? '',
      contentFormat: CONTENT_FORMAT,
      icon: dto.icon,
      changeSummary: dto.changeSummary,
      author: authorOf(principal),
      updatedById: principal.userId,
    });

    await this.auditWrite(principal, Action.PageUpdate, updated, ctx, {
      versionNumber: version.versionNumber,
    });
    this.emitPageEvent(principal, {
      type: PageEventType.Updated,
      pageId: updated.id,
      spaceId: updated.spaceId,
      title: updated.title,
      slug: updated.slug,
      updateKind: 'content',
    });
    return { page: updated, version, capabilities: this.capabilitiesFor(principal, updated.spaceId) };
  }

  async publish(principal: Principal, id: string, ctx: AuditContext): Promise<PageRecord> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PagePublish,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );
    const updated = await this.pages.setStatus(id, PageStatus.Published, principal.userId);
    await this.auditWrite(principal, Action.PagePublish, updated, ctx);
    this.emitPageEvent(principal, {
      type: PageEventType.Updated,
      pageId: updated.id,
      spaceId: updated.spaceId,
      title: updated.title,
      slug: updated.slug,
      updateKind: 'status',
    });
    return updated;
  }

  async archive(principal: Principal, id: string, ctx: AuditContext): Promise<PageRecord> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PageArchive,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );
    const updated = await this.pages.setStatus(id, PageStatus.Archived, principal.userId);
    await this.auditWrite(principal, Action.PageArchive, updated, ctx);
    this.emitPageEvent(principal, {
      type: PageEventType.Updated,
      pageId: updated.id,
      spaceId: updated.spaceId,
      title: updated.title,
      slug: updated.slug,
      updateKind: 'status',
    });
    return updated;
  }

  /** Hard-delete a page AND its entire subtree. Space-admin only. */
  async delete(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PageDelete,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );

    // Post-order collect: children before parents, so each delete removes a leaf
    // (self-relation parentId is NoAction, so a parent can't go before its child).
    const order: string[] = [];
    const collect = async (pid: string): Promise<void> => {
      for (const child of await this.pages.listChildren(pid)) await collect(child.id);
      order.push(pid);
    };
    await collect(id);

    for (const pid of order) await this.pages.delete(pid);
    await this.auditWrite(principal, Action.PageDelete, page, ctx, { deletedCount: order.length });
    // Fired ONCE for the subtree root; the full list rides along so automations
    // aren't stormed with one event per descendant.
    this.emitPageEvent(principal, {
      type: PageEventType.Deleted,
      pageId: page.id,
      spaceId: page.spaceId,
      title: page.title,
      slug: page.slug,
      deletedPageIds: order,
    });
  }

  /** Sort a page's direct subpages alphabetically. Space-admin (reorganize). */
  async sortChildren(principal: Principal, id: string, ctx: AuditContext): Promise<void> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PageReorganize,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );
    await this.pages.sortSiblings(page.spaceId, id);
    await this.auditWrite(principal, Action.PageReorganize, page, ctx, { sortChildren: true });
  }

  /** Sort a space's top-level pages alphabetically. Space-admin (reorganize). */
  async sortSpacePages(principal: Principal, spaceId: string, ctx: AuditContext): Promise<void> {
    const space = await this.spaces.findById(spaceId);
    if (!space) throw new NotFoundException('Space not found.');
    await this.authz.authorize(principal, Action.PageReorganize, { type: 'space', spaceId }, ctx);
    await this.pages.sortSiblings(spaceId, null);
    await this.audit.record(
      principal,
      { action: Action.PageReorganize, result: AuditResult.Success, targetType: 'space', targetId: spaceId, spaceId, metadata: { sortPages: true } },
      ctx,
    );
  }

  /** Rename a page (title only). Editor+. */
  async rename(principal: Principal, id: string, title: string, ctx: AuditContext): Promise<PageRecord> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PageUpdate,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );
    const trimmed = title.trim();
    if (!trimmed) throw new BadRequestException('A title is required.');
    const renamed = await this.pages.rename(id, trimmed);
    await this.auditWrite(principal, Action.PageUpdate, renamed, ctx, { rename: true, title: trimmed });
    this.emitPageEvent(principal, {
      type: PageEventType.Updated,
      pageId: renamed.id,
      spaceId: renamed.spaceId,
      title: renamed.title,
      slug: renamed.slug,
      updateKind: 'rename',
    });
    return renamed;
  }

  /**
   * Re-parent and/or reorder a page, optionally into another space. Requires
   * reorganize (space-admin) on the source space, and — for a cross-space move —
   * on the target space too. The whole subtree moves with the page.
   */
  async move(
    principal: Principal,
    id: string,
    dto: { parentId?: string | null; position: number; spaceId?: string },
    ctx: AuditContext,
  ): Promise<PageRecord> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PageReorganize,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );

    const newParentId = dto.parentId !== undefined ? dto.parentId : page.parentId;
    let newSpaceId = page.spaceId;

    if (newParentId !== null) {
      if (newParentId === id) throw new BadRequestException('A page cannot be its own parent.');
      const parent = await this.requirePage(newParentId);
      newSpaceId = parent.spaceId; // the target space follows the chosen parent
      // Reject cycles: the new parent must not be the page or one of its descendants.
      let cursor: string | null = parent.parentId;
      while (cursor) {
        if (cursor === id) throw new BadRequestException('Cannot move a page under its own descendant.');
        const anc: PageRecord | null = await this.pages.findById(cursor);
        cursor = anc?.parentId ?? null;
      }
    } else if (dto.spaceId) {
      newSpaceId = dto.spaceId; // move to the top level of the chosen space
    }

    // A cross-space move also needs reorganize rights on the destination space.
    if (newSpaceId !== page.spaceId) {
      const target = await this.spaces.findById(newSpaceId);
      if (!target) throw new NotFoundException('Target space not found.');
      await this.authz.authorize(
        principal,
        Action.PageReorganize,
        { type: 'space', spaceId: newSpaceId },
        ctx,
      );
    }

    const moved = await this.pages.move(id, newParentId, dto.position, newSpaceId);
    await this.auditWrite(principal, Action.PageReorganize, moved, ctx, {
      parentId: newParentId,
      position: dto.position,
      fromSpaceId: page.spaceId,
      toSpaceId: newSpaceId,
    });
    this.emitPageEvent(principal, {
      type: PageEventType.Moved,
      pageId: moved.id,
      spaceId: moved.spaceId,
      title: moved.title,
      slug: moved.slug,
      move: {
        fromSpaceId: page.spaceId,
        fromParentId: page.parentId,
        toSpaceId: newSpaceId,
        toParentId: newParentId,
        position: dto.position,
      },
    });
    return moved;
  }

  /**
   * Set a page's integration metadata (a JSON object). Page-level and NOT versioned:
   * this never appends a content version. `merge` shallow-merges top-level keys onto
   * the existing metadata (a value of null deletes that key); otherwise it replaces
   * the whole object. Requires edit rights on the page.
   */
  async setMetadata(
    principal: Principal,
    id: string,
    value: Record<string, unknown>,
    opts: { merge: boolean },
    ctx: AuditContext,
  ): Promise<PageDetail> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.PageUpdate,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );

    let next: Record<string, unknown>;
    if (opts.merge) {
      next = { ...page.metadata };
      for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) delete next[k];
        else next[k] = v;
      }
    } else {
      next = value;
    }

    // Defensive server-side cap (the DTO also enforces it on the incoming payload).
    if (JSON.stringify(next).length > 64_000) {
      throw new BadRequestException('Resulting metadata exceeds the 64000-byte limit.');
    }

    const updated = await this.pages.setMetadata(id, next);
    await this.auditWrite(principal, Action.PageUpdate, updated, ctx, {
      metadata: true,
      merge: opts.merge,
      keys: Object.keys(next),
    });
    this.emitPageEvent(principal, {
      type: PageEventType.Updated,
      pageId: updated.id,
      spaceId: updated.spaceId,
      title: updated.title,
      slug: updated.slug,
      updateKind: 'metadata',
    });
    const version = updated.currentVersionId
      ? await this.versions.findById(updated.currentVersionId)
      : null;
    return { page: updated, version, capabilities: this.capabilitiesFor(principal, updated.spaceId) };
  }

  /** Restore a prior version by appending it as a new version (history is never rewritten). */
  async restore(
    principal: Principal,
    id: string,
    versionId: string,
    ctx: AuditContext,
  ): Promise<PageDetail> {
    const page = await this.requirePage(id);
    await this.authz.authorize(
      principal,
      Action.VersionRestore,
      { type: 'page', spaceId: page.spaceId, pageId: id },
      ctx,
    );

    const source = await this.versions.findById(versionId);
    if (!source || source.pageId !== id) {
      throw new NotFoundException('Version not found on this page.');
    }

    const { page: updated, version } = await this.pages.addRevision(id, {
      title: source.title,
      content: source.content,
      contentFormat: source.contentFormat,
      changeSummary: `Restored from v${source.versionNumber}`,
      author: authorOf(principal),
      updatedById: principal.userId,
    });

    await this.audit.record(
      principal,
      {
        action: Action.VersionRestore,
        result: AuditResult.Success,
        targetType: 'page',
        targetId: id,
        spaceId: page.spaceId,
        metadata: { restoredFrom: source.versionNumber, newVersion: version.versionNumber },
      },
      ctx,
    );
    this.emitPageEvent(principal, {
      type: PageEventType.Updated,
      pageId: updated.id,
      spaceId: updated.spaceId,
      title: updated.title,
      slug: updated.slug,
      updateKind: 'restore',
    });
    return { page: updated, version, capabilities: this.capabilitiesFor(principal, updated.spaceId) };
  }

  // ---- helpers ----

  private async requirePage(id: string): Promise<PageRecord> {
    const page = await this.pages.findById(id);
    if (!page) throw new NotFoundException('Page not found.');
    return page;
  }

  // Accepts either a UUID (canonical id) or a short public code (pretty URLs).
  private static readonly UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  private async requirePageRef(idOrCode: string): Promise<PageRecord> {
    const page = PagesService.UUID_RE.test(idOrCode)
      ? await this.pages.findById(idOrCode)
      : await this.pages.findByShortId(idOrCode);
    if (!page) throw new NotFoundException('Page not found.');
    return page;
  }

  /** Published pages need viewer+; drafts/archived need editor+ (PageReadDraft). */
  private async authorizeRead(
    principal: Principal,
    page: PageRecord,
    ctx: AuditContext,
  ): Promise<void> {
    const action =
      page.status === PageStatus.Published ? Action.PageReadPublished : Action.PageReadDraft;
    await this.authz.authorize(
      principal,
      action,
      { type: 'page', spaceId: page.spaceId, pageId: page.id },
      ctx,
    );
  }

  private async auditWrite(
    principal: Principal,
    action: Action,
    page: PageRecord,
    ctx: AuditContext,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record(
      principal,
      {
        action,
        result: AuditResult.Success,
        targetType: 'page',
        targetId: page.id,
        spaceId: page.spaceId,
        metadata,
      },
      ctx,
    );
  }
}
