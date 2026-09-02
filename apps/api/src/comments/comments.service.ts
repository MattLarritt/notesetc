import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Action, type ActorType, AuditResult, type Principal } from '@notesetc/shared';
import { type AuditContext, AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { type CommentRecord, CommentRepository } from '../repositories/comment.repository';
import { PageRepository } from '../repositories/page.repository';
import { UserRepository } from '../repositories/user.repository';

export interface CommentNode {
  id: string;
  parentId: string | null;
  authorType: ActorType;
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

@Injectable()
export class CommentsService {
  constructor(
    private readonly comments: CommentRepository,
    private readonly pages: PageRepository,
    private readonly users: UserRepository,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async requirePage(id: string) {
    const page = await this.pages.findById(id);
    if (!page) throw new NotFoundException('Page not found.');
    return page;
  }
  private async requireComment(id: string): Promise<CommentRecord> {
    const c = await this.comments.findById(id);
    if (!c) throw new NotFoundException('Comment not found.');
    return c;
  }

  private authorLabel(c: CommentRecord, userLabel: Map<string, string>): string {
    if (c.authorType === 'human' && c.authorUserId) return userLabel.get(c.authorUserId) ?? 'Unknown user';
    if (c.aiAgentLabel) return c.aiAgentLabel;
    if (c.authorType === 'api_token') return 'API token';
    if (c.authorType === 'ai_tool') return 'AI tool';
    return 'System';
  }

  async list(principal: Principal, pageId: string, ctx: AuditContext): Promise<CommentsView> {
    const page = await this.requirePage(pageId);
    await this.authz.authorize(principal, Action.SpaceRead, { type: 'space', spaceId: page.spaceId }, ctx);

    const on = { type: 'space' as const, spaceId: page.spaceId };
    const canComment = this.authz.can(principal, Action.CommentCreate, on);
    const canModerate = this.authz.can(principal, Action.CommentModerate, on);

    const rows = await this.comments.listByPage(pageId);
    const userIds = new Set<string>();
    for (const c of rows) {
      if (c.authorUserId) userIds.add(c.authorUserId);
      if (c.resolvedById) userIds.add(c.resolvedById);
    }
    const users = await this.users.findByIds([...userIds]);
    const userLabel = new Map(users.map((u) => [u.id, u.email]));

    const toNode = (c: CommentRecord): CommentNode => {
      const deleted = c.status === 'deleted';
      const isAuthor = !!c.authorUserId && c.authorUserId === principal.userId;
      return {
        id: c.id,
        parentId: c.parentId,
        authorType: c.authorType,
        authorUserId: c.authorUserId,
        authorLabel: this.authorLabel(c, userLabel),
        aiAgentLabel: c.aiAgentLabel,
        body: deleted ? '' : c.body,
        createdAt: c.createdAt.toISOString(),
        editedAt: c.editedAt?.toISOString() ?? null,
        deleted,
        resolved: c.resolved,
        resolvedByLabel: c.resolvedById ? userLabel.get(c.resolvedById) ?? null : null,
        canEdit: !deleted && isAuthor,
        canDelete: !deleted && (isAuthor || canModerate),
        canResolve: !deleted && c.parentId === null && canComment,
        replies: [],
      };
    };

    // Build one level of threading. A reply whose parent is missing is shown at root.
    const roots: CommentNode[] = [];
    const byId = new Map<string, CommentNode>();
    for (const c of rows) if (c.parentId === null) { const n = toNode(c); byId.set(c.id, n); roots.push(n); }
    for (const c of rows) {
      if (c.parentId === null) continue;
      const node = toNode(c);
      const parent = byId.get(c.parentId);
      if (parent) parent.replies.push(node);
      else roots.push(node);
    }

    return { comments: roots, canComment };
  }

  async create(
    principal: Principal,
    pageId: string,
    input: { body: string; parentId?: string | null },
    ctx: AuditContext,
  ): Promise<CommentRecord> {
    const page = await this.requirePage(pageId);
    await this.authz.authorize(principal, Action.CommentCreate, { type: 'space', spaceId: page.spaceId }, ctx);

    const body = input.body.trim();
    if (!body) throw new BadRequestException('A comment cannot be empty.');

    // Resolve the true thread root: replies are flattened to one level.
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await this.requireComment(input.parentId);
      if (parent.pageId !== pageId) throw new BadRequestException('Parent comment is on a different page.');
      if (parent.status === 'deleted') throw new BadRequestException('Cannot reply to a deleted comment.');
      parentId = parent.parentId ?? parent.id;
    }

    const record = await this.comments.create({
      pageId,
      parentId,
      body,
      authorType: principal.actorType,
      authorUserId: principal.userId,
      authorTokenId: principal.tokenId ?? null,
      aiAgentLabel: principal.agentLabel ?? null,
    });
    await this.audit.record(
      principal,
      { action: 'comment.create', result: AuditResult.Success, targetType: 'comment', targetId: record.id, spaceId: page.spaceId, metadata: { pageId, parentId } },
      ctx,
    );
    return record;
  }

  async update(principal: Principal, commentId: string, body: string, ctx: AuditContext): Promise<CommentRecord> {
    const c = await this.requireComment(commentId);
    const page = await this.requirePage(c.pageId);
    await this.authz.authorize(principal, Action.CommentCreate, { type: 'space', spaceId: page.spaceId }, ctx);
    if (c.status === 'deleted') throw new BadRequestException('This comment was deleted.');
    if (c.authorUserId !== principal.userId) throw new ForbiddenException('You can only edit your own comment.');

    const trimmed = body.trim();
    if (!trimmed) throw new BadRequestException('A comment cannot be empty.');
    const updated = await this.comments.update(commentId, trimmed);
    await this.audit.record(
      principal,
      { action: 'comment.update', result: AuditResult.Success, targetType: 'comment', targetId: commentId, spaceId: page.spaceId },
      ctx,
    );
    return updated;
  }

  async remove(principal: Principal, commentId: string, ctx: AuditContext): Promise<void> {
    const c = await this.requireComment(commentId);
    const page = await this.requirePage(c.pageId);
    const on = { type: 'space' as const, spaceId: page.spaceId };
    const isAuthor = c.authorUserId === principal.userId;
    const canModerate = this.authz.can(principal, Action.CommentModerate, on);
    if (!isAuthor && !canModerate) throw new ForbiddenException('You cannot delete this comment.');
    if (c.status === 'deleted') return; // already gone — idempotent

    await this.comments.softDelete(commentId);
    await this.audit.record(
      principal,
      { action: 'comment.delete', result: AuditResult.Success, targetType: 'comment', targetId: commentId, spaceId: page.spaceId, metadata: { moderated: !isAuthor } },
      ctx,
    );
  }

  async setResolved(principal: Principal, commentId: string, resolved: boolean, ctx: AuditContext): Promise<CommentRecord> {
    const c = await this.requireComment(commentId);
    const page = await this.requirePage(c.pageId);
    await this.authz.authorize(principal, Action.CommentCreate, { type: 'space', spaceId: page.spaceId }, ctx);
    if (c.parentId !== null) throw new BadRequestException('Only a top-level comment thread can be resolved.');
    if (c.status === 'deleted') throw new BadRequestException('This comment was deleted.');

    const updated = await this.comments.setResolved(commentId, {
      resolved,
      resolvedById: resolved ? principal.userId : null,
      resolvedAt: resolved ? new Date() : null,
    });
    await this.audit.record(
      principal,
      { action: resolved ? 'comment.resolve' : 'comment.reopen', result: AuditResult.Success, targetType: 'comment', targetId: commentId, spaceId: page.spaceId },
      ctx,
    );
    return updated;
  }
}
