import { Injectable } from '@nestjs/common';
import type { ActorType } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { PageVersionRecord } from './page.repository';
import { PageVersionRepository } from './page-version.repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toVersion(v: any): PageVersionRecord {
  return {
    id: v.id,
    pageId: v.pageId,
    versionNumber: v.versionNumber,
    title: v.title,
    content: v.content,
    contentFormat: v.contentFormat,
    changeSummary: v.changeSummary,
    authorType: v.authorType as ActorType,
    authorUserId: v.authorUserId,
    authorTokenId: v.authorTokenId,
    aiAgentLabel: v.aiAgentLabel,
    createdAt: v.createdAt,
  };
}

@Injectable()
export class PrismaPageVersionRepository extends PageVersionRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string): Promise<PageVersionRecord | null> {
    const v = await this.prisma.pageVersion.findUnique({ where: { id } });
    return v ? toVersion(v) : null;
  }

  async listByPage(pageId: string): Promise<PageVersionRecord[]> {
    const rows = await this.prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { versionNumber: 'desc' },
    });
    return rows.map(toVersion);
  }
}
