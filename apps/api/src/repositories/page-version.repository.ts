import type { PageVersionRecord } from './page.repository';

/** Read boundary for version history. Writes happen via PageRepository (aggregate). */
export abstract class PageVersionRepository {
  abstract findById(id: string): Promise<PageVersionRecord | null>;
  /** History for a page, newest first. */
  abstract listByPage(pageId: string): Promise<PageVersionRecord[]>;
}
