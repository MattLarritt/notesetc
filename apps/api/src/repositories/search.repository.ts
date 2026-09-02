import type { PageStatus } from '@notesetc/shared';

export interface SearchRow {
  id: string;
  spaceId: string;
  slug: string;
  title: string;
  icon: string | null;
  status: PageStatus;
  /** Current version content, for snippet extraction. */
  content: string;
}

export interface SearchParams {
  query: string;
  /** Restrict to these space ids. `undefined` = no space restriction (e.g. global admin). */
  spaceIds?: string[];
  limit: number;
}

/**
 * Search boundary (DI token). The POC implementation does a case-insensitive
 * substring match on title + current-version content; a production build can
 * swap in Postgres/MSSQL full-text or an external engine without touching the
 * SearchService, which owns permission scoping.
 */
export abstract class SearchRepository {
  abstract search(params: SearchParams): Promise<SearchRow[]>;
}
