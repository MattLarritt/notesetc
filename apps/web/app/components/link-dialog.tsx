'use client';

import { useEffect, useMemo, useState } from 'react';

interface PickPage {
  id: string;
  title: string;
  slug: string;
  status: string;
  parentId: string | null;
  position: number;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
}

interface PickSpace {
  id: string;
  key: string;
  name: string;
}

export interface LinkResult {
  href: string;
  /** Suggested link text (used only when nothing is selected in the editor). */
  text: string;
}

type Crumb = { kind: 'space' | 'page'; id: string; label: string };

/**
 * Insert-link dialog: an external URL, or a link to an existing Notes Etc page.
 * The page picker is a drill-in file browser — start at the list of spaces,
 * open one to see its top-level pages, keep opening to walk into subpages, with
 * a breadcrumb to jump back. Typing searches across everything at once.
 */
export function LinkDialog({
  onInsert,
  onClose,
}: {
  onInsert: (result: LinkResult) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'url' | 'page'>('url');
  const [url, setUrl] = useState('https://');
  const [query, setQuery] = useState('');
  const [spaces, setSpaces] = useState<PickSpace[]>([]);
  const [pages, setPages] = useState<PickPage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState<Crumb[]>([]); // [] = at the space list

  useEffect(() => {
    if (tab !== 'page' || pages !== null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sr = await fetch('/api/bff/spaces', { credentials: 'include' });
        const { data: spaceList } = (await sr.json()) as { data: PickSpace[] };
        const all: PickPage[] = [];
        for (const s of spaceList) {
          const pr = await fetch(`/api/bff/spaces/${s.id}/pages`, { credentials: 'include' });
          if (!pr.ok) continue;
          const { data } = (await pr.json()) as {
            data: {
              id: string;
              title: string;
              slug: string;
              status: string;
              parentId: string | null;
              position: number;
            }[];
          };
          data.forEach((p) => all.push({ ...p, spaceId: s.id, spaceKey: s.key, spaceName: s.name }));
        }
        if (!cancelled) {
          setSpaces(spaceList);
          setPages(all);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, pages]);

  const allPages = pages ?? [];
  const hasChildren = (pageId: string) => allPages.some((p) => p.parentId === pageId);
  const childrenAt = (spaceId: string, parentId: string | null) =>
    allPages
      .filter((p) => p.spaceId === spaceId && p.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return allPages
      .filter((p) => p.title.toLowerCase().includes(q) || p.spaceKey.toLowerCase().includes(q))
      .slice(0, 50);
  }, [allPages, q]);

  const pick = (id: string, title: string) => onInsert({ href: `/pages/${id}`, text: title });
  const openSpace = (s: PickSpace) => setPath([{ kind: 'space', id: s.id, label: s.name }]);
  const openPage = (p: PickPage) => setPath((prev) => [...prev, { kind: 'page', id: p.id, label: p.title }]);

  // Current browser location derived from the breadcrumb path.
  const spaceId = path[0]?.id ?? null;
  const parentId = path.length > 1 ? path[path.length - 1].id : null;
  const currentPages = spaceId ? childrenAt(spaceId, parentId) : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Insert link</strong>
          <button className="tb-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button className="tab" data-active={tab === 'url' || undefined} onClick={() => setTab('url')}>
            External URL
          </button>
          <button className="tab" data-active={tab === 'page' || undefined} onClick={() => setTab('page')}>
            Notes Etc page
          </button>
        </div>

        {tab === 'url' ? (
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) onInsert({ href: url.trim(), text: url.trim() });
            }}
          >
            <input
              className="field"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
            <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
              <button type="submit" className="btn-primary">
                Insert link
              </button>
            </div>
          </form>
        ) : (
          <div className="modal-body">
            <input
              className="field"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all pages…"
            />

            {/* Breadcrumb (hidden while searching). */}
            {!q && (
              <div className="fb-crumbs">
                <button className="fb-crumb" onClick={() => setPath([])}>
                  Spaces
                </button>
                {path.map((c, i) => (
                  <span key={c.id}>
                    <span className="fb-sep">›</span>
                    <button className="fb-crumb" onClick={() => setPath(path.slice(0, i + 1))}>
                      {c.label}
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="fb-list">
              {loading && <div className="picker-empty">Loading…</div>}

              {/* Search results: flat, click to insert. */}
              {!loading && q && matches.length === 0 && <div className="picker-empty">No matching pages.</div>}
              {!loading &&
                q &&
                matches.map((p) => (
                  <button key={p.id} className="fb-row" onClick={() => pick(p.id, p.title)}>
                    <span className="fb-ic">📄</span>
                    <span className="fb-name">{p.title}</span>
                    <span className="picker-meta">
                      {p.spaceKey}
                      {p.status !== 'published' && ` · ${p.status}`}
                    </span>
                  </button>
                ))}

              {/* Browser: at root show spaces; inside, show pages at this level. */}
              {!loading && !q && path.length === 0 &&
                spaces.map((s) => (
                  <button key={s.id} className="fb-row" onClick={() => openSpace(s)}>
                    <span className="fb-ic">📁</span>
                    <span className="fb-name">{s.name}</span>
                    <span className="fb-open">›</span>
                  </button>
                ))}

              {!loading && !q && path.length > 0 && currentPages.length === 0 && (
                <div className="picker-empty">No pages here.</div>
              )}
              {!loading &&
                !q &&
                path.length > 0 &&
                currentPages.map((p) => (
                  <div key={p.id} className="fb-row-wrap">
                    <button className="fb-row fb-row-main" onClick={() => pick(p.id, p.title)}>
                      <span className="fb-ic">📄</span>
                      <span className="fb-name">{p.title}</span>
                      {p.status !== 'published' && <span className="picker-meta">{p.status}</span>}
                    </button>
                    {hasChildren(p.id) && (
                      <button className="fb-drill" title="Open subpages" onClick={() => openPage(p)}>
                        ›
                      </button>
                    )}
                  </div>
                ))}
            </div>
            {!q && <p className="fb-hint">Click a page to link it; use › to open its subpages.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
