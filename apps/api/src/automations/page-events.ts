import type { ActorType, PageEventType } from '@notesetc/shared';

/**
 * Emitted by PagesService after a successful page mutation (post-write,
 * post-audit). Consumed by the automation trigger listener. Listeners run
 * detached ({async: true}); a failing listener can never break the mutation.
 */
export interface PageEvent {
  type: PageEventType;
  pageId: string;
  spaceId: string;
  title: string;
  slug: string;
  /** For page.updated: what kind of update this was. */
  updateKind?: 'content' | 'rename' | 'metadata' | 'status' | 'restore';
  /** For page.moved. */
  move?: {
    fromSpaceId: string;
    fromParentId: string | null;
    toSpaceId: string;
    toParentId: string | null;
    position: number;
  };
  /** For page.deleted (fired once, for the subtree root). */
  deletedPageIds?: string[];
  actor: { type: ActorType; userId?: string; label?: string };
  /**
   * Loop guard: true when the mutation came from an automation that did NOT
   * opt in with {allowTriggers: true}. Stamped from the AsyncLocalStorage run
   * context at emission time.
   */
  suppressAutomations: boolean;
  /** How many automation hops led here (0 = user/API-initiated). Capped by the listener. */
  automationDepth: number;
  occurredAt: string;
}
