import type { ActorType, ProposalStatus } from '@notesetc/shared';

export interface ProposalRecord {
  id: string;
  pageId: string;
  baseVersionId: string;
  proposedTitle: string | null;
  proposedContent: string;
  rationale: string | null;
  status: ProposalStatus;
  originType: ActorType;
  createdById: string | null;
  createdTokenId: string | null;
  aiAgentLabel: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface CreateProposalInput {
  pageId: string;
  baseVersionId: string;
  proposedTitle?: string | null;
  proposedContent: string;
  rationale?: string | null;
  originType: ActorType;
  createdById?: string | null;
  createdTokenId?: string | null;
  aiAgentLabel?: string | null;
}

/** Persistence boundary for suggested changes (DI token). */
export abstract class ProposalRepository {
  abstract create(input: CreateProposalInput): Promise<ProposalRecord>;
  abstract findById(id: string): Promise<ProposalRecord | null>;
  abstract listByPage(pageId: string): Promise<ProposalRecord[]>;
  abstract updateStatus(
    id: string,
    status: ProposalStatus,
    reviewedById: string | null,
    reviewedAt: Date | null,
  ): Promise<ProposalRecord>;
  /** Mark all open proposals on a page as superseded (optionally excluding one). */
  abstract supersedeOpen(pageId: string, exceptId?: string): Promise<void>;
}
