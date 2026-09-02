import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  type MaintainerRecord,
  PageMaintainerRepository,
} from './page-maintainer.repository';

type PrismaMaintainer = {
  id: string;
  pageId: string;
  principalType: string;
  principalId: string;
  createdAt: Date;
};

const toRecord = (m: PrismaMaintainer): MaintainerRecord => ({
  id: m.id,
  pageId: m.pageId,
  principalType: m.principalType as 'user' | 'group',
  principalId: m.principalId,
  createdAt: m.createdAt,
});

@Injectable()
export class PrismaPageMaintainerRepository extends PageMaintainerRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listForPage(pageId: string): Promise<MaintainerRecord[]> {
    const rows = await this.prisma.pageMaintainer.findMany({
      where: { pageId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<MaintainerRecord | null> {
    const m = await this.prisma.pageMaintainer.findUnique({ where: { id } });
    return m ? toRecord(m) : null;
  }

  async create(input: {
    pageId: string;
    principalType: 'user' | 'group';
    principalId: string;
  }): Promise<MaintainerRecord> {
    const m = await this.prisma.pageMaintainer.upsert({
      where: {
        pageId_principalType_principalId: {
          pageId: input.pageId,
          principalType: input.principalType,
          principalId: input.principalId,
        },
      },
      create: input,
      update: {},
    });
    return toRecord(m);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.pageMaintainer.delete({ where: { id } });
  }

  async pageIdsForPrincipals(userId: string, groupIds: string[]): Promise<string[]> {
    const rows = await this.prisma.pageMaintainer.findMany({
      where: {
        OR: [
          { principalType: 'user', principalId: userId },
          ...(groupIds.length ? [{ principalType: 'group', principalId: { in: groupIds } }] : []),
        ],
      },
      select: { pageId: true },
    });
    return [...new Set(rows.map((r) => r.pageId))];
  }
}
