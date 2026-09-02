import { Injectable } from '@nestjs/common';
import { Action, PageStatus, type Principal } from '@notesetc/shared';
import { AuthorizationService } from '../authz/authorization.service';
import { SearchRepository } from '../repositories/search.repository';
import { SpaceRepository } from '../repositories/space.repository';

export interface SearchResult {
  pageId: string;
  spaceId: string;
  title: string;
  slug: string;
  icon: string | null;
  status: PageStatus;
  snippet: string;
}

const MIN_QUERY = 2;
const FETCH_LIMIT = 60;
const RESULT_LIMIT = 25;

@Injectable()
export class SearchService {
  constructor(
    private readonly search: SearchRepository,
    private readonly spaces: SpaceRepository,
    private readonly authz: AuthorizationService,
  ) {}

  async query(
    principal: Principal,
    q: string,
    spaceKey: string | undefined,
  ): Promise<SearchResult[]> {
    const query = q.trim();
    if (query.length < MIN_QUERY) return [];

    const scope = await this.resolveScope(principal, spaceKey);
    if (scope.empty) return [];

    const rows = await this.search.search({ query, spaceIds: scope.spaceIds, limit: FETCH_LIMIT });

    const results: SearchResult[] = [];
    for (const row of rows) {
      // Enforce draft visibility per result (published => viewer, draft => editor).
      const action =
        row.status === PageStatus.Published ? Action.PageReadPublished : Action.PageReadDraft;
      if (!this.authz.can(principal, action, { type: 'page', spaceId: row.spaceId })) continue;

      results.push({
        pageId: row.id,
        spaceId: row.spaceId,
        title: row.title,
        slug: row.slug,
        icon: row.icon,
        status: row.status,
        snippet: makeSnippet(row.content, query),
      });
      if (results.length >= RESULT_LIMIT) break;
    }
    return results;
  }

  /**
   * Which spaces to search. Global admins search everything (optionally narrowed
   * to one space); others are limited to spaces they hold any grant on.
   */
  private async resolveScope(
    principal: Principal,
    spaceKey: string | undefined,
  ): Promise<{ spaceIds?: string[]; empty: boolean }> {
    let filterId: string | undefined;
    if (spaceKey) {
      const space = await this.spaces.findByKey(spaceKey);
      if (!space) return { empty: true };
      filterId = space.id;
    }

    if (principal.globalRole === 'global_admin') {
      return { spaceIds: filterId ? [filterId] : undefined, empty: false };
    }

    const readable = [
      ...new Set(
        principal.grants.filter((g) => g.resourceType === 'space').map((g) => g.resourceId),
      ),
    ];
    // Respect a token's space restriction if present.
    const allowed = principal.allowedSpaceIds
      ? readable.filter((id) => principal.allowedSpaceIds!.includes(id))
      : readable;

    const scoped = filterId ? allowed.filter((id) => id === filterId) : allowed;
    return { spaceIds: scoped, empty: scoped.length === 0 };
  }
}

/** Build a short, plain-text snippet around the first match (or the start). */
function makeSnippet(content: string, query: string): string {
  const plain = content
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/:::\w+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const idx = plain.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return plain.slice(0, 160) + (plain.length > 160 ? '…' : '');
  const start = Math.max(0, idx - 50);
  const end = Math.min(plain.length, idx + query.length + 110);
  return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
}
