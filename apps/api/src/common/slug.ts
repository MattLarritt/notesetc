/**
 * Derive a URL-safe slug from a title: NFKD-normalize (so accented letters
 * decompose), then lowercase and collapse every run of non-alphanumerics to a
 * single hyphen, trimmed. Falls back to "page" for empty results.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'page';
}
