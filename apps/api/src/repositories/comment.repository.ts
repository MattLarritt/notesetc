import type { ActorType } from '@notesetc/shared';

export interface CommentRecord {
  id: string;
  pageId: string;
  parentId: string | null;
  body: string;
  status: 'active' | 'deleted';
  resolved: boolean;
  resolvedById: string | null;
  resolvedAt: Date | null;
  authorType: ActorType;
  authorUserId: string | null;
  authorTokenId: string | null;
  aiAgentLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
}

export interface CreateCommentInput {
  pageId: string;
  parentId: string | null;
  body: string;
  authorType: ActorType;
  authorUserId?: string | null;
  authorTokenId?: string | null;
  aiAgentLabel?: string | null;
}

/** Persistence boundary for page comments (DI token). */
export abstract class CommentRepository {
  /** All comments for a page (incl. deleted tombstones), oldest first; the service builds the tree. */
  abstract listByPage(pageId: string): Promise<CommentRecord[]>;
  abstract findById(id: string): Promise<CommentRecord | null>;
  abstract create(input: CreateCommentInput): Promise<CommentRecord>;
  abstract update(id: string, body: string): Promise<CommentRecord>;
  /** Soft-delete: mark deleted and clear the body (thread structure is preserved). */
  abstract softDelete(id: string): Promise<void>;
  abstract setResolved(
    id: string,
    input: { resolved: boolean; resolvedById: string | null; resolvedAt: Date | null },
  ): Promise<CommentRecord>;
}
