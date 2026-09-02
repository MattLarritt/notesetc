// Pretty page URLs: /p/<title-slug>-<shortId>. The slug is cosmetic; resolution
// is by the trailing short code, so renames/moves never break a link. Old
// /pages/<uuid> links still resolve (and the page route redirects them here).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL-safe slug from a title (mirrors the API's slugify). */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'page';
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Turn a route param — a UUID, a full `<slug>-<code>` handle, or a bare code —
 * into the value the API resolves (a UUID or a short code).
 */
export function pageRefFromParam(param: string): string {
  if (isUuid(param)) return param;
  const dash = param.lastIndexOf('-');
  return dash >= 0 ? param.slice(dash + 1) : param;
}

type PageLike = { id: string; title: string; shortId?: string | null };

/** Canonical pretty path for a page, e.g. `/p/access-control-k7Qm2p`. */
export function pageUrl(page: PageLike): string {
  if (!page.shortId) return `/pages/${page.id}`;
  return `/p/${slugify(page.title)}-${page.shortId}`;
}
