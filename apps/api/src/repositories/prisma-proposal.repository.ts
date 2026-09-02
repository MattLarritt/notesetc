import { Injectable } from '@nestjs/common';
import type { ActorType, ProposalStatus } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateProposalInput,
  type ProposalRecord,
  ProposalRepository,
} from './proposal.repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRecord(p: any): ProposalRecord {
  return {
    id: p.id,
    pageId: p.pageId,
    baseVersionId: p.baseVersionId,
    proposedTitle: p.proposedTitle,
    proposedContent: p.proposedContent,
    rationale: p.rationale,
    status: p.status as ProposalStatus,
    originType: p.originType as ActorType,
    createdById: p.createdById,
    createdTokenId: p.createdTokenId,
    aiAgentLabel: p.aiAgentLabel,
    reviewedById: p.reviewedById,
    reviewedAt: p.reviewedAt,
    createdAt: p.createdAt,
  };
}

@Injectable()
export class PrismaProposalRepository extends ProposalRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateProposalInput): Promise<ProposalRecord> {
    const p = await this.prisma.pageProposal.create({
      data: {
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
      },
    });
    return toRecord(p);
  }

  async findById(id: string): Promise<ProposalRecord | null> {
    const p = await this.prisma.pageProposal.findUnique({ where: { id } });
    return p ? toRecord(p) : null;
  }

  async listByPage(pageId: string): Promise<ProposalRecord[]> {
    const rows = await this.prisma.pageProposal.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async updateStatus(
    id: string,
    status: ProposalStatus,
    reviewedById: string | null,
    reviewedAt: Date | null,
  ): Promise<ProposalRecord> {
    const p = await this.prisma.pageProposal.update({
      where: { id },
      data: { status, reviewedById, reviewedAt },
    });
    return toRecord(p);
  }

  async supersedeOpen(pageId: string, exceptId?: string): Promise<void> {
    await this.prisma.pageProposal.updateMany({
      where: { pageId, status: 'open', ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { status: 'superseded' },
    });
  }
}
