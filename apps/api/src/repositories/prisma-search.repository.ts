import { Injectable } from '@nestjs/common';
import type { PageStatus } from '@notesetc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { type SearchParams, type SearchRow, SearchRepository } from './search.repository';

@Injectable()
export class PrismaSearchRepository extends SearchRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async search(params: SearchParams): Promise<SearchRow[]> {
    // Case-insensitive substring on title or current-version content.
    // (Postgres: `mode: 'insensitive'` -> ILIKE. On SQL Server the default
    // collation is already case-insensitive; a dedicated impl would drop `mode`.)
    const rows = await this.prisma.page.findMany({
      where: {
        status: { not: 'archived' },
        ...(params.spaceIds ? { spaceId: { in: params.spaceIds } } : {}),
        OR: [
          { title: { contains: params.query, mode: 'insensitive' } },
          { currentVersion: { content: { contains: params.query, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        spaceId: true,
        slug: true,
        title: true,
        icon: true,
        status: true,
        currentVersion: { select: { content: true } },
      },
      take: params.limit,
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      spaceId: r.spaceId,
      slug: r.slug,
      title: r.title,
      icon: r.icon,
      status: r.status as PageStatus,
      content: r.currentVersion?.content ?? '',
    }));
  }
}
