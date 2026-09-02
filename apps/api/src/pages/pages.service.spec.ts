import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { GlobalRole, PageStatus, type Principal, ResourceRole } from '@notesetc/shared';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { type AuditEntry, AuditRepository } from '../repositories/audit.repository';
import { PageVersionRepository } from '../repositories/page-version.repository';
import {
  type CreatePageInput,
  type PageRecord,
  PageRepository,
  type PageVersionRecord,
  type RevisionInput,
} from '../repositories/page.repository';
import { type SpaceRecord, SpaceRepository } from '../repositories/space.repository';
import { PagesService } from './pages.service';

// Shared in-memory store so the page + version fakes stay consistent.
class Store {
  pages: PageRecord[] = [];
  versions: PageVersionRecord[] = [];
}

class FakeAuditRepository extends AuditRepository {
  entries: AuditEntry[] = [];
  async append(e: AuditEntry): Promise<void> {
    this.entries.push(e);
  }
}

class FakePageRepository extends PageRepository {
  constructor(private readonly store: Store) {
    super();
  }
  private nextVersionNumber(pageId: string): number {
    const nums = this.store.versions.filter((v) => v.pageId === pageId).map((v) => v.versionNumber);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  }
  async create(input: CreatePageInput) {
    const page: PageRecord = {
      id: randomUUID(),
      spaceId: input.spaceId,
      parentId: input.parentId,
      slug: input.slug,
      shortId: input.shortId,
      title: input.title,
      status: PageStatus.Draft,
      ownerId: input.ownerId,
      currentVersionId: null,
      position: input.position,
      createdById: input.createdById,
      updatedById: input.createdById,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
    this.store.pages.push(page);
    const version = this.makeVersion(page.id, input.title, input.content, input.author, input.changeSummary);
    page.currentVersionId = version.id;
    return { page, version };
  }
  async addRevision(pageId: string, input: RevisionInput) {
    const page = this.store.pages.find((p) => p.id === pageId)!;
    const version = this.makeVersion(pageId, input.title, input.content, input.author, input.changeSummary);
    page.title = input.title;
    page.currentVersionId = version.id;
    page.updatedById = input.updatedById;
    return { page, version };
  }
  private makeVersion(
    pageId: string,
    title: string,
    content: string,
    author: CreatePageInput['author'],
    changeSummary?: string,
  ): PageVersionRecord {
    const version: PageVersionRecord = {
      id: randomUUID(),
      pageId,
      versionNumber: this.nextVersionNumber(pageId),
      title,
      content,
      contentFormat: 'hfm/1',
      changeSummary: changeSummary ?? null,
      authorType: author.authorType,
      authorUserId: author.authorUserId ?? null,
      authorTokenId: author.authorTokenId ?? null,
      aiAgentLabel: author.aiAgentLabel ?? null,
      createdAt: new Date(),
    };
    this.store.versions.push(version);
    return version;
  }
  async setStatus(pageId: string, status: PageStatus, updatedById: string) {
    const page = this.store.pages.find((p) => p.id === pageId)!;
    page.status = status;
    page.updatedById = updatedById;
    return page;
  }
  async findById(id: string) {
    return this.store.pages.find((p) => p.id === id) ?? null;
  }
  async findByShortId(shortId: string) {
    return this.store.pages.find((p) => p.shortId === shortId) ?? null;
  }
  async findBySlug(spaceId: string, parentId: string | null, slug: string) {
    return this.store.pages.find((p) => p.spaceId === spaceId && p.parentId === parentId && p.slug === slug) ?? null;
  }
  async listBySpace(spaceId: string) {
    return this.store.pages.filter((p) => p.spaceId === spaceId);
  }
  async listChildren(parentId: string) {
    return this.store.pages.filter((p) => p.parentId === parentId);
  }
  async countSiblings(spaceId: string, parentId: string | null) {
    return this.store.pages.filter((p) => p.spaceId === spaceId && p.parentId === parentId).length;
  }
  async resolveByPath(spaceId: string, slugs: string[]) {
    let parentId: string | null = null;
    let current: PageRecord | null = null;
    for (const slug of slugs) {
      const found: PageRecord | null = await this.findBySlug(spaceId, parentId, slug);
      if (!found) return null;
      current = found;
      parentId = found.id;
    }
    return current;
  }
}

class FakePageVersionRepository extends PageVersionRepository {
  constructor(private readonly store: Store) {
    super();
  }
  async findById(id: string) {
    return this.store.versions.find((v) => v.id === id) ?? null;
  }
  async listByPage(pageId: string) {
    return this.store.versions
      .filter((v) => v.pageId === pageId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }
}

const SPACE = 'space-1';
class FakeSpaceRepository extends SpaceRepository {
  async list() {
    return [];
  }
  async findById() {
    return null;
  }
  async findByKey(key: string): Promise<SpaceRecord | null> {
    if (key !== 'IT') return null;
    return {
      id: SPACE,
      key: 'IT',
      name: 'IT',
      description: null,
      ownerId: null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
  }
  async create() {
    throw new Error('unused');
  }
  async update() {
    throw new Error('unused');
  }
  async archive() {
    throw new Error('unused');
  }
}

function principal(globalRole: GlobalRole, role?: ResourceRole): Principal {
  return {
    userId: 'u1',
    email: 'u1@example.com',
    globalRole,
    grants: role ? [{ resourceType: 'space', resourceId: SPACE, role }] : [],
    via: 'session',
    actorType: 'human',
  };
}

describe('PagesService', () => {
  let store: Store;
  let audit: FakeAuditRepository;
  let svc: PagesService;

  beforeEach(() => {
    store = new Store();
    audit = new FakeAuditRepository();
    const auditSvc = new AuditService(audit);
    svc = new PagesService(
      new FakePageRepository(store),
      new FakePageVersionRepository(store),
      new FakeSpaceRepository(),
      new AuthorizationService(auditSvc),
      auditSvc,
      // Event fan-out is not under test; a bare emitter is enough.
      { emit: () => true } as unknown as import('@nestjs/event-emitter').EventEmitter2,
    );
  });

  const editor = () => principal(GlobalRole.Member, ResourceRole.Editor);
  const viewer = () => principal(GlobalRole.Member, ResourceRole.Viewer);

  it('creates a page as a draft with version 1', async () => {
    const { page, version } = await svc.create(editor(), SPACE, { title: 'Runbook', content: '# Hi' }, {});
    expect(page.status).toBe(PageStatus.Draft);
    expect(page.slug).toBe('runbook');
    expect(version.versionNumber).toBe(1);
    expect(version.authorType).toBe('human');
    expect(audit.entries.some((e) => e.action === 'page.create' && e.result === 'success')).toBe(true);
  });

  it('creating a page requires editor+ (viewer denied)', async () => {
    await expect(svc.create(viewer(), SPACE, { title: 'X', content: '' }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a duplicate slug in the same parent', async () => {
    await svc.create(editor(), SPACE, { title: 'Runbook', content: '' }, {});
    await expect(svc.create(editor(), SPACE, { title: 'Runbook', content: '' }, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('update appends version 2 and moves the current pointer', async () => {
    const { page } = await svc.create(editor(), SPACE, { title: 'Doc', content: 'v1' }, {});
    const { version } = await svc.update(editor(), page.id, { content: 'v2', baseVersionNumber: 1 }, {});
    expect(version.versionNumber).toBe(2);
    expect(version.content).toBe('v2');
    const history = await svc.listVersions(editor(), page.id, {});
    expect(history.map((v) => v.versionNumber)).toEqual([2, 1]);
  });

  it('rejects a stale update (wrong baseVersionNumber) with 409', async () => {
    const { page } = await svc.create(editor(), SPACE, { title: 'Doc', content: 'v1' }, {});
    await svc.update(editor(), page.id, { content: 'v2', baseVersionNumber: 1 }, {});
    await expect(
      svc.update(editor(), page.id, { content: 'oops', baseVersionNumber: 1 }, {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('restore creates a NEW version from an old one (history preserved)', async () => {
    const { page, version: v1 } = await svc.create(editor(), SPACE, { title: 'Doc', content: 'original' }, {});
    await svc.update(editor(), page.id, { content: 'changed', baseVersionNumber: 1 }, {});

    const { version: restored } = await svc.restore(editor(), page.id, v1.id, {});
    expect(restored.versionNumber).toBe(3);
    expect(restored.content).toBe('original');
    expect(restored.changeSummary).toContain('Restored from v1');
    expect(audit.entries.some((e) => e.action === 'version.restore')).toBe(true);
  });

  it('hides drafts from viewers but shows published pages', async () => {
    const { page } = await svc.create(editor(), SPACE, { title: 'Secret', content: '' }, {});

    // Draft: viewer cannot read.
    await expect(svc.getById(viewer(), page.id, {})).rejects.toBeInstanceOf(ForbiddenException);
    // list() omits the draft for the viewer.
    expect(await svc.list(viewer(), SPACE, {})).toHaveLength(0);

    // Publish, then the viewer can read + list it.
    await svc.publish(editor(), page.id, {});
    await expect(svc.getById(viewer(), page.id, {})).resolves.toMatchObject({
      page: { status: PageStatus.Published },
    });
    expect(await svc.list(viewer(), SPACE, {})).toHaveLength(1);
  });

  it('resolves a nested page by slug path', async () => {
    const { page: parent } = await svc.create(editor(), SPACE, { title: 'Parent', content: '' }, {});
    await svc.create(editor(), SPACE, { title: 'Child', content: '', parentId: parent.id }, {});

    const found = await svc.getByPath(editor(), 'IT', 'parent/child', {});
    expect(found.page.slug).toBe('child');

    await expect(svc.getByPath(editor(), 'IT', 'parent/missing', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
