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
    // Tokenised, ranked matching. The old implementation matched the whole
    // query as ONE substring, so any multi-word search ("pool pump",
    // "tools inventory") returned nothing unless the words appeared verbatim
    // and adjacent. Now: rows matching ANY term are fetched, then ranked —
    // full-phrase hit > per-term title hits > per-term content hits.
    // Kept as portable `contains` filters (no Postgres-only tsquery) so the
    // SQL Server variant behaves identically.
    const terms = [...new Set(params.query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2))];
    if (!terms.length) return [];

    const rows = await this.prisma.page.findMany({
      where: {
        status: { not: 'archived' },
        ...(params.spaceIds ? { spaceId: { in: params.spaceIds } } : {}),
        OR: terms.flatMap((t) => [
          { title: { contains: t, mode: 'insensitive' as const } },
          { currentVersion: { content: { contains: t, mode: 'insensitive' as const } } },
        ]),
      },
      select: {
        id: true,
        spaceId: true,
        slug: true,
        title: true,
        icon: true,
        status: true,
        updatedAt: true,
        currentVersion: { select: { content: true } },
      },
      take: Math.max(params.limit * 5, 100),
      orderBy: { updatedAt: 'desc' },
    });

    const phrase = params.query.toLowerCase();
    const scored = rows
      .map((r) => {
        const title = r.title.toLowerCase();
        const content = (r.currentVersion?.content ?? '').toLowerCase();
        let score = 0;
        let matched = 0;
        for (const t of terms) {
          const inTitle = title.includes(t);
          const inContent = content.includes(t);
          if (inTitle) score += 3;
          if (inContent) score += 1;
          if (inTitle || inContent) matched += 1;
        }
        if (terms.length > 1 && (title.includes(phrase) || content.includes(phrase))) score += 5;
        return { r, score, matched };
      })
      .filter((x) => x.matched > 0)
      .sort(
        (a, b) =>
          b.matched - a.matched ||
          b.score - a.score ||
          b.r.updatedAt.getTime() - a.r.updatedAt.getTime(),
      )
      .slice(0, params.limit)
      .map((x) => x.r);

    return scored.map((r) => ({
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
