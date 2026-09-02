import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { GlobalRole, PageStatus, type Principal, ResourceRole } from '@notesetc/shared';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { type AuditEntry, AuditRepository } from '../repositories/audit.repository';
import { PageVersionRepository } from '../repositories/page-version.repository';
import {
  type PageRecord,
  PageRepository,
  type PageVersionRecord,
  type RevisionInput,
} from '../repositories/page.repository';
import {
  type CreateProposalInput,
  type ProposalRecord,
  ProposalRepository,
} from '../repositories/proposal.repository';
import { ProposalsService } from './proposals.service';

const SPACE = 'space-1';
const PAGE = 'page-1';
const V1 = 'ver-1';

class FakeAudit extends AuditRepository {
  entries: AuditEntry[] = [];
  async append(e: AuditEntry) {
    this.entries.push(e);
  }
}

class FakePages extends PageRepository {
  page: PageRecord = {
    id: PAGE,
    spaceId: SPACE,
    parentId: null,
    slug: 'p',
    shortId: 'p1code0',
    title: 'Original Title',
    icon: null,
    status: PageStatus.Published,
    ownerId: null,
    currentVersionId: V1,
    position: 0,
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
  };
  lastRevision: RevisionInput | null = null;
  versionCounter = 1;

  async create(): Promise<never> {
    throw new Error('unused');
  }
  async addRevision(pageId: string, input: RevisionInput) {
    this.lastRevision = input;
    this.versionCounter += 1;
    const version: PageVersionRecord = {
      id: randomUUID(),
      pageId,
      versionNumber: this.versionCounter,
      title: input.title,
      content: input.content,
      contentFormat: input.contentFormat,
      changeSummary: input.changeSummary ?? null,
      authorType: input.author.authorType,
      authorUserId: input.author.authorUserId ?? null,
      authorTokenId: input.author.authorTokenId ?? null,
      aiAgentLabel: input.author.aiAgentLabel ?? null,
      createdAt: new Date(),
    };
    this.page = { ...this.page, currentVersionId: version.id, title: input.title };
    return { page: this.page, version };
  }
  async setStatus(): Promise<never> {
    throw new Error('unused');
  }
  async findById(id: string) {
    return id === PAGE ? this.page : null;
  }
  async findByShortId(shortId: string) {
    return shortId === this.page.shortId ? this.page : null;
  }
  async findBySlug() {
    return null;
  }
  async listBySpace() {
    return [];
  }
  async listChildren() {
    return [];
  }
  async countSiblings() {
    return 0;
  }
  async resolveByPath() {
    return null;
  }
}

class FakeVersions extends PageVersionRepository {
  async findById() {
    return null;
  }
  async listByPage() {
    return [];
  }
}

class FakeProposals extends ProposalRepository {
  rows: ProposalRecord[] = [];
  async create(input: CreateProposalInput) {
    const p: ProposalRecord = {
      id: randomUUID(),
      pageId: input.pageId,
      baseVersionId: input.baseVersionId,
      proposedTitle: input.proposedTitle ?? null,
      proposedContent: input.proposedContent,
      rationale: input.rationale ?? null,
      status: 'open',
      originType: input.originType,
      createdById: input.createdById ?? null,
      createdTokenId: input.createdTokenId ?? null,
      aiAgentLabel: input.aiAgentLabel ?? null,
      reviewedById: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
    this.rows.push(p);
    return p;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listByPage(pageId: string) {
    return this.rows.filter((r) => r.pageId === pageId);
  }
  async updateStatus(id: string, status: ProposalRecord['status'], reviewedById: string | null, reviewedAt: Date | null) {
    const p = this.rows.find((r) => r.id === id)!;
    p.status = status;
    p.reviewedById = reviewedById;
    p.reviewedAt = reviewedAt;
    return p;
  }
  async supersedeOpen(pageId: string, exceptId?: string) {
    for (const r of this.rows) {
      if (r.pageId === pageId && r.status === 'open' && r.id !== exceptId) r.status = 'superseded';
    }
  }
}

function principal(role?: ResourceRole, actorType: Principal['actorType'] = 'human'): Principal {
  return {
    userId: 'u1',
    email: 'u1@example.com',
    globalRole: GlobalRole.Member,
    grants: role ? [{ resourceType: 'space', resourceId: SPACE, role }] : [],
    via: 'session',
    actorType,
  };
}

describe('ProposalsService', () => {
  let pages: FakePages;
  let proposals: FakeProposals;
  let audit: FakeAudit;
  let svc: ProposalsService;

  beforeEach(() => {
    pages = new FakePages();
    proposals = new FakeProposals();
    audit = new FakeAudit();
    const auditSvc = new AuditService(audit);
    svc = new ProposalsService(
      pages,
      new FakeVersions(),
      proposals,
      new AuthorizationService(auditSvc),
      auditSvc,
    );
  });

  const editor = () => principal(ResourceRole.Editor);

  it('records origin + base version on create', async () => {
    const p = await svc.create(editor(), PAGE, { proposedContent: 'new body', rationale: 'clearer' }, {});
    expect(p.baseVersionId).toBe(V1);
    expect(p.originType).toBe('human');
    expect(p.status).toBe('open');
    expect(audit.entries.some((e) => e.action === 'proposal.create')).toBe(true);
  });

  it('denies proposal creation to a viewer', async () => {
    await expect(
      svc.create(principal(ResourceRole.Viewer), PAGE, { proposedContent: 'x' }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approve applies the proposal as a new version attributed to the proposer', async () => {
    const p = await svc.create(editor(), PAGE, { proposedContent: '# Updated', proposedTitle: 'New Title' }, {});
    const approver = principal(ResourceRole.SpaceAdmin);
    const { proposal, version } = await svc.approve(approver, p.id, {});

    expect(proposal.status).toBe('approved');
    expect(proposal.reviewedById).toBe('u1');
    expect(version.content).toBe('# Updated');
    expect(version.title).toBe('New Title');
    expect(version.authorType).toBe('human'); // origin
    expect(pages.lastRevision?.changeSummary).toContain('Approved proposal');
    expect(audit.entries.some((e) => e.action === 'proposal.approve')).toBe(true);
  });

  it('supersedes other open proposals when one is approved', async () => {
    const a = await svc.create(editor(), PAGE, { proposedContent: 'A' }, {});
    const b = await svc.create(editor(), PAGE, { proposedContent: 'B' }, {});
    await svc.approve(editor(), a.id, {});
    const bAfter = await proposals.findById(b.id);
    expect(bAfter?.status).toBe('superseded');
  });

  it('rejects approval when the base version is stale (page changed)', async () => {
    const p = await svc.create(editor(), PAGE, { proposedContent: 'A' }, {});
    // Simulate the page moving on to a new current version.
    pages.page = { ...pages.page, currentVersionId: 'ver-99' };
    await expect(svc.approve(editor(), p.id, {})).rejects.toBeInstanceOf(ConflictException);
    const after = await proposals.findById(p.id);
    expect(after?.status).toBe('superseded');
  });

  it('reject marks the proposal rejected', async () => {
    const p = await svc.create(editor(), PAGE, { proposedContent: 'A' }, {});
    const r = await svc.reject(editor(), p.id, {});
    expect(r.status).toBe('rejected');
    await expect(svc.reject(editor(), p.id, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list marks stale open proposals superseded', async () => {
    const p = await svc.create(editor(), PAGE, { proposedContent: 'A' }, {});
    pages.page = { ...pages.page, currentVersionId: 'ver-99' };
    const list = await svc.listForPage(editor(), PAGE, {});
    expect(list.find((x) => x.id === p.id)?.status).toBe('superseded');
  });
});
