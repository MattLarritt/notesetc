import type { ActorType, PageStatus } from '@notesetc/shared';

export interface PageRecord {
  id: string;
  spaceId: string;
  parentId: string | null;
  slug: string;
  /** Short, stable, URL-friendly public code (base62). May be null on legacy rows. */
  shortId: string | null;
  title: string;
  icon: string | null;
  status: PageStatus;
  ownerId: string | null;
  currentVersionId: string | null;
  position: number;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  reviewIntervalDays: number | null;
  reviewDueAt: Date | null;
  lastReviewedAt: Date | null;
  lastReviewedById: string | null;
  childTemplateId: string | null;
  /** Integration metadata — a parsed JSON object (never null; empty is {}). */
  metadata: Record<string, unknown>;
}

export interface PageVersionRecord {
  id: string;
  pageId: string;
  versionNumber: number;
  title: string;
  content: string;
  contentFormat: string;
  changeSummary: string | null;
  authorType: ActorType;
  authorUserId: string | null;
  authorTokenId: string | null;
  aiAgentLabel: string | null;
  createdAt: Date;
}

/** Author-traceability fields carried onto every version. */
export interface VersionAuthor {
  authorType: ActorType;
  authorUserId?: string | null;
  authorTokenId?: string | null;
  aiAgentLabel?: string | null;
}

export interface CreatePageInput {
  spaceId: string;
  parentId: string | null;
  slug: string;
  shortId: string;
  title: string;
  icon?: string | null;
  ownerId: string;
  createdById: string;
  position: number;
  content: string;
  contentFormat: string;
  changeSummary?: string;
  author: VersionAuthor;
}

export interface RevisionInput {
  title: string;
  content: string;
  contentFormat: string;
  /** Page-level icon (not versioned). undefined = leave unchanged. */
  icon?: string | null;
  changeSummary?: string;
  author: VersionAuthor;
  updatedById: string;
}

/**
 * Persistence boundary for the Page aggregate (page + its versions). Content
 * mutations create a new version AND move the `currentVersionId` pointer in a
 * single transaction, so history is append-only and never partially written.
 */
export abstract class PageRepository {
  // --- aggregate writes (transactional) ---
  abstract create(input: CreatePageInput): Promise<{ page: PageRecord; version: PageVersionRecord }>;
  abstract addRevision(
    pageId: string,
    input: RevisionInput,
  ): Promise<{ page: PageRecord; version: PageVersionRecord }>;
  abstract setStatus(
    pageId: string,
    status: PageStatus,
    updatedById: string,
  ): Promise<PageRecord>;
  /**
   * Re-parent and/or reorder a page, reindexing its target siblings. When
   * `newSpaceId` differs from the page's current space, the page moves to that
   * space (its slug is de-duplicated on collision) and its entire subtree is
   * re-homed to the new space.
   */
  abstract move(
    pageId: string,
    newParentId: string | null,
    newIndex: number,
    newSpaceId?: string,
  ): Promise<PageRecord>;
  /** Rename a page: updates the page title and its current version's title. */
  abstract rename(pageId: string, title: string): Promise<PageRecord>;
  /** Reorder the direct children under (spaceId, parentId) alphabetically by title. */
  abstract sortSiblings(spaceId: string, parentId: string | null): Promise<void>;
  /** Hard-delete a page and its dependents (versions, maintainers, proposals,
   *  tags); attachments are detached (kept in the space). Caller ensures the
   *  page has no children first. */
  abstract delete(pageId: string): Promise<void>;

  // --- maintenance / review schedule ---
  abstract setReview(
    pageId: string,
    input: { reviewIntervalDays: number | null; reviewDueAt: Date | null },
  ): Promise<PageRecord>;
  abstract markReviewed(
    pageId: string,
    input: { lastReviewedAt: Date; lastReviewedById: string; reviewDueAt: Date | null },
  ): Promise<PageRecord>;
  /** Set (or clear) the template pre-filled for this page's new subpages. */
  abstract setChildTemplate(pageId: string, templateId: string | null): Promise<PageRecord>;
  /** Replace the page's integration metadata (already merged/validated by the service). */
  abstract setMetadata(pageId: string, metadata: Record<string, unknown>): Promise<PageRecord>;

  // --- reads ---
  abstract findById(id: string): Promise<PageRecord | null>;
  /** Resolve a page by its short public code (pretty-URL lookups). */
  abstract findByShortId(shortId: string): Promise<PageRecord | null>;
  abstract findByIds(ids: string[]): Promise<PageRecord[]>;
  abstract findBySlug(
    spaceId: string,
    parentId: string | null,
    slug: string,
  ): Promise<PageRecord | null>;
  abstract listBySpace(spaceId: string): Promise<PageRecord[]>;
  abstract listChildren(parentId: string): Promise<PageRecord[]>;
  abstract countSiblings(spaceId: string, parentId: string | null): Promise<number>;
  /** Resolve a slash path of slugs within a space by walking parentId. */
  abstract resolveByPath(spaceId: string, slugs: string[]): Promise<PageRecord | null>;
}
