import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Action,
  AuditResult,
  CONTENT_FORMAT,
  PageStatus,
  type Principal,
  ProposalStatus,
} from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { PageVersionRepository } from '../repositories/page-version.repository';
import {
  type PageRecord,
  PageRepository,
  type PageVersionRecord,
  type VersionAuthor,
} from '../repositories/page.repository';
import { type ProposalRecord, ProposalRepository } from '../repositories/proposal.repository';
import type { CreateProposalDto } from './dto';

/**
 * Suggested-change workflow. Proposals capture a change against a specific base
 * version without touching the page. Approval applies the proposal as a NEW
 * page version, attributed to the original proposer (human/API/AI) for
 * traceability, with the approver recorded in the audit log.
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly pages: PageRepository,
    private readonly versions: PageVersionRepository,
    private readonly proposals: ProposalRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async create(
    principal: Principal,
    pageId: string,
    dto: CreateProposalDto,
    ctx: AuditContext,
  ): Promise<ProposalRecord> {
    const page = await this.requirePage(pageId);
    await this.authz.authorize(
      principal,
      Action.ProposalCreate,
      { type: 'page', spaceId: page.spaceId, pageId },
      ctx,
    );
    if (!page.currentVersionId) {
      throw new BadRequestException('Page has no base version to propose against.');
    }

    const proposal = await this.proposals.create({
      pageId,
      baseVersionId: page.currentVersionId,
      proposedTitle: dto.proposedTitle ?? null,
      proposedContent: dto.proposedContent,
      rationale: dto.rationale ?? null,
      originType: principal.actorType,
      createdById: principal.userId,
      createdTokenId: principal.tokenId ?? null,
      aiAgentLabel: principal.agentLabel ?? null,
    });

    await this.audit.record(
      principal,
      {
        action: Action.ProposalCreate,
        result: AuditResult.Success,
        targetType: 'proposal',
        targetId: proposal.id,
        spaceId: page.spaceId,
        metadata: { pageId, originType: proposal.originType },
      },
      ctx,
    );
    return proposal;
  }

  async listForPage(
    principal: Principal,
    pageId: string,
    ctx: AuditContext,
  ): Promise<ProposalRecord[]> {
    const page = await this.requirePage(pageId);
    await this.authorizeRead(principal, page, ctx);

    const proposals = await this.proposals.listByPage(pageId);
    // Lazily mark open proposals stale if the page moved on since they were made.
    const result: ProposalRecord[] = [];
    for (const p of proposals) {
      if (p.status === ProposalStatus.Open && p.baseVersionId !== page.currentVersionId) {
        result.push(await this.proposals.updateStatus(p.id, ProposalStatus.Superseded, null, null));
      } else {
        result.push(p);
      }
    }
    return result;
  }

  async approve(
    principal: Principal,
    proposalId: string,
    ctx: AuditContext,
  ): Promise<{ proposal: ProposalRecord; version: PageVersionRecord }> {
    const proposal = await this.requireProposal(proposalId);
    const page = await this.requirePage(proposal.pageId);
    await this.authz.authorize(
      principal,
      Action.ProposalReview,
      { type: 'page', spaceId: page.spaceId, pageId: page.id },
      ctx,
    );

    if (proposal.status !== ProposalStatus.Open) {
      throw new BadRequestException(`Proposal is ${proposal.status}, not open.`);
    }
    // Stale base: the page changed since the proposal was made.
    if (proposal.baseVersionId !== page.currentVersionId) {
      await this.proposals.updateStatus(proposalId, ProposalStatus.Superseded, null, null);
      throw new ConflictException(
        'The page changed since this proposal was created; it has been superseded.',
      );
    }

    // Apply as a new version, attributed to the original proposer.
    const author: VersionAuthor = {
      authorType: proposal.originType,
      authorUserId: proposal.createdById,
      authorTokenId: proposal.createdTokenId,
      aiAgentLabel: proposal.aiAgentLabel,
    };
    const { version } = await this.pages.addRevision(page.id, {
      title: proposal.proposedTitle ?? page.title,
      content: proposal.proposedContent,
      contentFormat: CONTENT_FORMAT,
      changeSummary: `Approved proposal${proposal.rationale ? `: ${proposal.rationale}` : ''}`,
      author,
      updatedById: principal.userId,
    });

    const now = new Date();
    const approved = await this.proposals.updateStatus(
      proposalId,
      ProposalStatus.Approved,
      principal.userId,
      now,
    );
    // Any other open proposals are now based on a stale version.
    await this.proposals.supersedeOpen(page.id, proposalId);

    await this.audit.record(
      principal,
      {
        action: 'proposal.approve',
        result: AuditResult.Success,
        targetType: 'proposal',
        targetId: proposalId,
        spaceId: page.spaceId,
        metadata: {
          pageId: page.id,
          newVersion: version.versionNumber,
          originType: proposal.originType,
          proposedBy: proposal.createdById,
          aiAgentLabel: proposal.aiAgentLabel,
        },
      },
      ctx,
    );
    return { proposal: approved, version };
  }

  async reject(
    principal: Principal,
    proposalId: string,
    ctx: AuditContext,
  ): Promise<ProposalRecord> {
    const proposal = await this.requireProposal(proposalId);
    const page = await this.requirePage(proposal.pageId);
    await this.authz.authorize(
      principal,
      Action.ProposalReview,
      { type: 'page', spaceId: page.spaceId, pageId: page.id },
      ctx,
    );
    if (proposal.status !== ProposalStatus.Open) {
      throw new BadRequestException(`Proposal is ${proposal.status}, not open.`);
    }

    const rejected = await this.proposals.updateStatus(
      proposalId,
      ProposalStatus.Rejected,
      principal.userId,
      new Date(),
    );
    await this.audit.record(
      principal,
      {
        action: 'proposal.reject',
        result: AuditResult.Success,
        targetType: 'proposal',
        targetId: proposalId,
        spaceId: page.spaceId,
        metadata: { pageId: page.id },
      },
      ctx,
    );
    return rejected;
  }

  private async requirePage(id: string): Promise<PageRecord> {
    const page = await this.pages.findById(id);
    if (!page) throw new NotFoundException('Page not found.');
    return page;
  }

  private async requireProposal(id: string): Promise<ProposalRecord> {
    const p = await this.proposals.findById(id);
    if (!p) throw new NotFoundException('Proposal not found.');
    return p;
  }

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
}
