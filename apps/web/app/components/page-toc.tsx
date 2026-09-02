import Link from 'next/link';
import type { Page } from '../../lib/api';
import { pageUrl } from '../../lib/page-url';

/**
 * Dynamic table of contents for a page: the tree of its descendant pages, built
 * live from the space's page list (so it updates as subpages are added/moved).
 * Renders nothing when the page has no children.
 */
export function PageToc({ pages, rootId }: { pages: Page[]; rootId: string }) {
  const childrenOf = (pid: string) =>
    pages.filter((p) => p.parentId === pid).sort((a, b) => a.position - b.position);

  const render = (pid: string) => {
    const kids = childrenOf(pid);
    if (kids.length === 0) return null;
    return (
      <ul className="toc">
        {kids.map((k) => (
          <li key={k.id}>
            <Link href={pageUrl(k)}>{k.title}</Link>
            {k.status !== 'published' && <span className={`badge ${k.status}`}>{k.status}</span>}
            {render(k.id)}
          </li>
        ))}
      </ul>
    );
  };

  return render(rootId);
}
