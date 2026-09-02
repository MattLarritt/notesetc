'use client';

/**
 * The left NavTree is a persistent client component that caches its data, so a
 * router.refresh() (which only re-runs server components) won't update it.
 * Mutations dispatch this event; the tree listens and re-fetches its roots +
 * any currently-loaded branches.
 */
export const NAV_REFRESH_EVENT = 'notesetc:nav-refresh';

export function refreshNav(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NAV_REFRESH_EVENT));
  }
}
