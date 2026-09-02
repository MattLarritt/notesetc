import Link from 'next/link';
import { getSpace, listPages, type Page } from '../../../lib/api';
import { pageUrl } from '../../../lib/page-url';
import { renderHfmToSafeHtml } from '../../../lib/render';
import { AppIcon } from '../../components/app-icon';

export const dynamic = 'force-dynamic';

interface TreeNode extends Page {
  children: TreeNode[];
}

function buildTree(pages: Page[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  pages.forEach((p) => byId.set(p.id, { ...p, children: [] }));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** The dynamic TOC: a live index of the space's pages. */
function Toc({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul className="toc">
      {nodes.map((n) => (
        <li key={n.id}>
          <Link href={pageUrl(n)}>{n.title}</Link>
          {n.status !== 'published' && <span className={`badge ${n.status}`}>{n.status}</span>}
          {n.children.length > 0 && <Toc nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export default async function SpaceOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [space, pages] = await Promise.all([getSpace(id), listPages(id)]);

  if (!space) {
    return (
      <div className="doc">
        <h1>Space not found</h1>
        <Link href="/spaces">← All spaces</Link>
      </div>
    );
  }

  const tree = buildTree(pages);
  const overviewHtml = space.overview ? renderHfmToSafeHtml(space.overview) : null;

  return (
    <div className="doc space-overview">
      <div className="space-header">
        <AppIcon icon={space.icon || 'folder'} className="space-header-icon" size={40} />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>{space.name}</h1>
          {space.description && (
            <p style={{ margin: '0.2rem 0 0', color: 'var(--color-text-muted)' }}>
              {space.description}
            </p>
          )}
        </div>
      </div>

      <div className="page-actions">
        <Link href={`/spaces/${space.id}/overview/edit`} className="btn-primary" style={{ textDecoration: 'none' }}>
          Edit overview
        </Link>
        <Link href={`/spaces/${space.id}/new`} className="btn-secondary">
          ＋ New page
        </Link>
      </div>

      {overviewHtml ? (
        <div className="prose" dangerouslySetInnerHTML={{ __html: overviewHtml }} />
      ) : (
        <div className="callout note">
          This space has no overview yet.{' '}
          <Link href={`/spaces/${space.id}/overview/edit`}>Write one</Link>.
        </div>
      )}

      <div className="space-toc card">
        <h3 style={{ marginTop: 0 }}>Contents</h3>
        {tree.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No pages yet.</p>
        ) : (
          <Toc nodes={tree} />
        )}
      </div>
    </div>
  );
}
