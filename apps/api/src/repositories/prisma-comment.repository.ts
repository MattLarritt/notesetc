import { Injectable } from '@nestjs/common';
import type { ActorType } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CommentRecord,
  CommentRepository,
  type CreateCommentInput,
} from './comment.repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRecord(c: any): CommentRecord {
  return {
    id: c.id,
    pageId: c.pageId,
    parentId: c.parentId,
    body: c.body,
    status: c.status,
    resolved: c.resolved,
    resolvedById: c.resolvedById,
    resolvedAt: c.resolvedAt,
    authorType: c.authorType as ActorType,
    authorUserId: c.authorUserId,
    authorTokenId: c.authorTokenId,
    aiAgentLabel: c.aiAgentLabel,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    editedAt: c.editedAt,
  };
}

@Injectable()
export class PrismaCommentRepository extends CommentRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByPage(pageId: string): Promise<CommentRecord[]> {
    // Return deleted rows too — they become tombstones so reply threads stay intact.
    const rows = await this.prisma.comment.findMany({
      where: { pageId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<CommentRecord | null> {
    const c = await this.prisma.comment.findUnique({ where: { id } });
    return c ? toRecord(c) : null;
  }

  async create(input: CreateCommentInput): Promise<CommentRecord> {
    const c = await this.prisma.comment.create({
      data: {
        pageId: input.pageId,
        parentId: input.parentId,
        body: input.body,
        authorType: input.authorType,
        authorUserId: input.authorUserId ?? null,
        authorTokenId: input.authorTokenId ?? null,
        aiAgentLabel: input.aiAgentLabel ?? null,
      },
    });
    return toRecord(c);
  }

  async update(id: string, body: string): Promise<CommentRecord> {
    const c = await this.prisma.comment.update({
      where: { id },
      data: { body, editedAt: new Date() },
    });
    return toRecord(c);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.comment.update({
      where: { id },
      data: { status: 'deleted', body: '' },
    });
  }

  async setResolved(
    id: string,
    input: { resolved: boolean; resolvedById: string | null; resolvedAt: Date | null },
  ): Promise<CommentRecord> {
    const c = await this.prisma.comment.update({
      where: { id },
      data: { resolved: input.resolved, resolvedById: input.resolvedById, resolvedAt: input.resolvedAt },
    });
    return toRecord(c);
  }
}
