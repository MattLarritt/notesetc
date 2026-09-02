'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppIcon } from './app-icon';
import { NAV_REFRESH_EVENT, refreshNav } from '../../lib/nav-refresh';
import { NavPageMenu, type MenuTarget } from './nav-page-menu';
import { pageUrl } from '../../lib/page-url';

interface SpaceNode {
  kind: 'space';
  id: string;
  key: string;
  name: string;
  icon: string | null;
}
interface PageNode {
  kind: 'page';
  id: string;
  spaceId: string;
  shortId: string | null;
  title: string;
  icon: string | null;
  status: string;
  hasChildren: boolean;
}
type Node = SpaceNode | PageNode;

/** Pixels of indentation per nesting level. */
const INDENT = 14;
/** How far right you must drag before a drop switches from "between" to "into". */
const NEST_DELTA = 22;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// --- Persist the tree's UI state across a browser refresh ---
// The open branch (accordion path) and scroll offset are stored per-browser so a
// reload lands you exactly where you were. The selected item is derived from the
// URL, so it re-highlights on its own once its branch is restored open.
const OPEN_KEY = 'notesetc:nav:open';
const SCROLL_KEY = 'notesetc:nav:scroll';

function loadStoredOpen(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveStoredOpen(path: string[]): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(path));
  } catch {
    /* storage unavailable / full — non-fatal */
  }
}
function loadStoredScroll(): number {
  try {
    return Number(localStorage.getItem(SCROLL_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveStoredScroll(n: number): void {
  try {
    localStorage.setItem(SCROLL_KEY, String(Math.round(n)));
  } catch {
    /* non-fatal */
  }
}

// --- A row in the flattened, in-display-order view of the tree ---
type SpaceRow = { type: 'space'; node: SpaceNode; ancestors: string[] };
type PageRow = {
  type: 'page';
  node: PageNode;
  ancestors: string[];
  /** parent page id, or null when the page sits at a space's top level */
  parentId: string | null;
  /** nesting depth among pages (0 = top level) */
  depth: number;
};
type Row = SpaceRow | PageRow;

/** Live drop target during a drag. */
type Drop = { overId: string; edge: 'above' | 'below'; nest: boolean };

/**
 * Lazy accordion navigation tree with dnd-kit reordering.
 * - Roots are spaces; with a single space its top-level pages become the roots.
 * - Children load on demand; only one path is open at a time.
 * - Space-admins can drag pages to reorder / re-nest them (gated by page.reorganize):
 *   a floating copy follows the cursor, a ghost holds the original slot, an
 *   insertion line shows where it lands, and a deliberate rightward drag nests it.
 */
export function NavTree({ isGlobalAdmin = false }: { isGlobalAdmin?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();

  const [roots, setRoots] = useState<Node[] | null>(null);
  const [soloSpace, setSoloSpace] = useState<SpaceNode | null>(null);
  const [restored, setRestored] = useState(false);
  const [childrenMap, setChildrenMap] = useState<Record<string, PageNode[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [openPath, setOpenPath] = useState<string[]>([]);
  // Space ids where the caller may reorganize (space_admin) — enables drag.
  const [reorg, setReorg] = useState<Set<string>>(new Set());

  // Right-click context menu target (a page row).
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);

  // Active drag state.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  // Cursor x at drag start — a rightward pull past NEST_DELTA switches to nesting.
  const dragStartX = useRef(0);

  // Refs so the (once-registered) refresh handler always sees current data.
  const nodeIndex = useRef(new Map<string, Node>());
  const childrenRef = useRef<Record<string, PageNode[]>>({});

  // Persistence: root element (to find the scroll container), and guards so we
  // persist only after the initial restore and restore scroll only once.
  const rootRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const scrollRestoredRef = useRef(false);
  const scrollElRef = useRef<HTMLElement | null>(null);

  // A small drag distance starts the gesture — snappy without hijacking clicks.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const toPageNodes = (
    data: {
      id: string;
      spaceId: string;
      shortId?: string | null;
      title: string;
      icon?: string | null;
      status: string;
      hasChildren?: boolean;
    }[],
  ): PageNode[] =>
    data.map((p) => ({
      kind: 'page',
      id: p.id,
      spaceId: p.spaceId,
      shortId: p.shortId ?? null,
      title: p.title,
      icon: p.icon ?? null,
      status: p.status,
      hasChildren: Boolean(p.hasChildren),
    }));

  const index = useCallback((nodes: Node[]) => {
    for (const n of nodes) nodeIndex.current.set(n.id, n);
  }, []);

  /** Fetch the tree roots (spaces, or a single space's top-level pages). */
  const fetchRoots = useCallback(async (): Promise<{ solo: SpaceNode | null; roots: Node[] }> => {
    const res = await getJson<{
      data: { id: string; key: string; name: string; icon: string | null; canReorganize?: boolean }[];
    }>('/api/bff/spaces');
    const spaces = res?.data ?? [];
    setReorg(new Set(spaces.filter((s) => s.canReorganize).map((s) => s.id)));
    if (spaces.length === 1) {
      const s = spaces[0];
      const solo: SpaceNode = { kind: 'space', id: s.id, key: s.key, name: s.name, icon: s.icon };
      const pr = await getJson<{ data: Parameters<typeof toPageNodes>[0] }>(
        `/api/bff/spaces/${s.id}/pages?parentId=root`,
      );
      return { solo, roots: toPageNodes(pr?.data ?? []) };
    }
    return {
      solo: null,
      roots: spaces.map((s) => ({ kind: 'space', id: s.id, key: s.key, name: s.name, icon: s.icon })),
    };
  }, []);

  const fetchChildrenFor = useCallback(async (node: Node): Promise<PageNode[]> => {
    const url =
      node.kind === 'space'
        ? `/api/bff/spaces/${node.id}/pages?parentId=root`
        : `/api/bff/spaces/${node.spaceId}/pages?parentId=${node.id}`;
    const res = await getJson<{ data: Parameters<typeof toPageNodes>[0] }>(url);
    return toPageNodes(res?.data ?? []);
  }, []);

  // Initial load + restore the open branch and scroll saved from last visit.
  useEffect(() => {
    (async () => {
      const { solo, roots: r } = await fetchRoots();
      setRoots(r);
      index(r);

      // Walk the stored accordion path, loading each level so the branch reopens.
      const stored = loadStoredOpen();
      const resolved: string[] = [];
      for (const id of stored) {
        const node = nodeIndex.current.get(id);
        if (!node) break; // something in the path was deleted — stop cleanly there
        resolved.push(id);
        if (!childrenRef.current[id]) {
          const kids = await fetchChildrenFor(node);
          index(kids);
          childrenRef.current = { ...childrenRef.current, [id]: kids };
        }
      }

      setSoloSpace(solo);
      setChildrenMap({ ...childrenRef.current });
      setOpenPath(resolved);
      restoredRef.current = true;
      setRestored(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the open branch (only after the initial restore, so we never clobber
  // the stored path with the empty starting state).
  useEffect(() => {
    if (restoredRef.current) saveStoredOpen(openPath);
  }, [openPath]);

  // Focus the page the URL points at: if its row is already rendered, scroll to
  // it; otherwise resolve its ancestor chain via the API, open that branch, and
  // then scroll. Covers deep links, search hits, and fresh sessions.
  const revealedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!restored || roots === null) return;
    const ref =
      pathname?.match(/^\/pages\/([^/]+)$/)?.[1] ??
      pathname?.match(/^\/p\/.+-([A-Za-z0-9]{5,14})$/)?.[1] ??
      null;
    if (!ref || revealedForRef.current === ref) return;
    revealedForRef.current = ref;

    const scrollToActive = () =>
      document.querySelector('.nav-row.active')?.scrollIntoView({ block: 'nearest' });

    requestAnimationFrame(() => {
      if (document.querySelector('.nav-row.active')) {
        scrollToActive(); // branch already open (e.g. clicked in the tree)
        return;
      }
      void (async () => {
        const detail = await getJson<{ page: { id: string; parentId: string | null; spaceId: string } }>(
          `/api/bff/pages/${ref}`,
        );
        if (!detail?.page) return;
        // Ancestor chain, oldest first; the leaf itself only needs its parents open.
        const ancestors: string[] = [];
        let parentId = detail.page.parentId;
        let guard = 0;
        while (parentId && guard++ < 30) {
          const parent = await getJson<{ page: { id: string; parentId: string | null } }>(
            `/api/bff/pages/${parentId}`,
          );
          if (!parent?.page) break;
          ancestors.unshift(parent.page.id);
          parentId = parent.page.parentId;
        }
        const path =
          soloSpace && soloSpace.id === detail.page.spaceId
            ? ancestors
            : [detail.page.spaceId, ...ancestors];
        for (const id of path) {
          const node = nodeIndex.current.get(id);
          if (!node) return; // not visible to this user — leave the tree alone
          if (!childrenRef.current[id]) {
            const kids = await fetchChildrenFor(node);
            index(kids);
            childrenRef.current = { ...childrenRef.current, [id]: kids };
          }
        }
        setChildrenMap({ ...childrenRef.current });
        setOpenPath(path);
        requestAnimationFrame(scrollToActive);
      })();
    });
  }, [restored, roots, pathname, soloSpace, fetchChildrenFor, index]);

  // Persist scroll offset (debounced) and restore it once, after the restored
  // branch has laid out. The scroll container is the .app-nav aside.
  useEffect(() => {
    const el = (rootRef.current?.closest('.app-nav') as HTMLElement | null) ?? null;
    scrollElRef.current = el;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => saveStoredScroll(el.scrollTop), 150);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (t) clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Restore the saved scroll offset once, after the restored rows have rendered.
  useEffect(() => {
    if (scrollRestoredRef.current || !restoredRef.current) return;
    const el = scrollElRef.current;
    if (!el) return;
    const target = loadStoredScroll();
    const raf = requestAnimationFrame(() => {
      el.scrollTop = target;
      scrollRestoredRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [childrenMap]);

  const loadChildren = useCallback(
    async (node: Node) => {
      if (childrenRef.current[node.id]) return;
      setLoading((prev) => new Set(prev).add(node.id));
      const kids = await fetchChildrenFor(node);
      index(kids);
      childrenRef.current = { ...childrenRef.current, [node.id]: kids };
      setChildrenMap(childrenRef.current);
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    },
    [fetchChildrenFor, index],
  );

  // Re-fetch roots + every currently-loaded branch when a mutation fires.
  useEffect(() => {
    async function refresh() {
      const { solo, roots: r } = await fetchRoots();
      setSoloSpace(solo);
      setRoots(r);
      index(r);
      // Re-fetch every loaded branch in PARALLEL so the tree updates snappily
      // after a mutation (create/rename/move/delete), not one round-trip at a time.
      const ids = Object.keys(childrenRef.current);
      const results = await Promise.all(
        ids.map(async (id) => {
          const node = nodeIndex.current.get(id);
          if (!node) return null;
          const kids = await fetchChildrenFor(node);
          index(kids);
          return [id, kids] as const;
        }),
      );
      const next: Record<string, PageNode[]> = {};
      for (const entry of results) if (entry) next[entry[0]] = entry[1];
      childrenRef.current = next;
      setChildrenMap(next);
      // Drop any open-path segments whose branch vanished (e.g. deleted).
      setOpenPath((prev) => {
        const kept: string[] = [];
        for (const id of prev) {
          if (nodeIndex.current.has(id)) kept.push(id);
          else break;
        }
        return kept.length === prev.length ? prev : kept;
      });
    }
    const handler = () => void refresh();
    window.addEventListener(NAV_REFRESH_EVENT, handler);
    return () => window.removeEventListener(NAV_REFRESH_EVENT, handler);
  }, [fetchRoots, fetchChildrenFor, index]);

  const toggle = useCallback(
    (node: Node, ancestors: string[]) => {
      setOpenPath((prev) => {
        const idx = prev.indexOf(node.id);
        if (idx !== -1) return prev.slice(0, idx); // collapse node + descendants
        return [...ancestors, node.id]; // open: single path
      });
      if (!openPath.includes(node.id)) void loadChildren(node);
    },
    [openPath, loadChildren],
  );

  // Clicking a space navigates to its overview and opens its branch.
  const openSpace = useCallback(
    (node: SpaceNode, ancestors: string[]) => {
      setOpenPath([...ancestors, node.id]);
      void loadChildren(node);
      router.push(`/spaces/${node.id}`);
    },
    [loadChildren, router],
  );

  const doMove = useCallback(
    async (draggedId: string, parentId: string | null, position: number) => {
      const cr = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
      const { csrfToken } = (await cr.json()) as { csrfToken: string };
      await fetch(`/api/bff/pages/${draggedId}/move`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ parentId, position }),
      });
      refreshNav();
    },
    [],
  );

  // --- Flatten the visible tree into ordered rows (space headers + page rows) ---
  const rows = useMemo<Row[]>(() => {
    if (!roots) return [];
    const out: Row[] = [];
    const walkChildren = (node: Node, depth: number, ancestors: string[]) => {
      if (!openPath.includes(node.id)) return;
      const kids = childrenMap[node.id];
      if (!kids) return;
      const parentId = node.kind === 'space' ? null : node.id;
      for (const kid of kids) {
        out.push({ type: 'page', node: kid, ancestors, parentId, depth });
        walkChildren(kid, depth + 1, [...ancestors, kid.id]);
      }
    };
    for (const r of roots) {
      if (r.kind === 'space') {
        out.push({ type: 'space', node: r, ancestors: [] });
        walkChildren(r, 0, [r.id]);
      } else {
        // solo mode: roots are the space's top-level pages
        out.push({ type: 'page', node: r, ancestors: [], parentId: null, depth: 0 });
        walkChildren(r, 1, [r.id]);
      }
    }
    return out;
  }, [roots, childrenMap, openPath]);

  /** ids of every visible descendant of a page (so a drag can't drop into itself). */
  const descendantsOf = useCallback(
    (id: string): Set<string> => {
      const acc = new Set<string>();
      const walk = (pid: string) => {
        for (const c of childrenMap[pid] ?? []) {
          acc.add(c.id);
          walk(c.id);
        }
      };
      walk(id);
      return acc;
    },
    [childrenMap],
  );

  // During a drag, hide the dragged item's own descendants — they travel with it.
  const hidden = useMemo(
    () => (activeId ? descendantsOf(activeId) : new Set<string>()),
    [activeId, descendantsOf],
  );
  const visibleRows = useMemo(
    () => rows.filter((r) => !(r.type === 'page' && hidden.has(r.node.id))),
    [rows, hidden],
  );
  const pageRows = useMemo(
    () => visibleRows.filter((r): r is PageRow => r.type === 'page'),
    [visibleRows],
  );
  const sortableIds = useMemo(() => pageRows.map((r) => r.node.id), [pageRows]);

  const activeNode = activeId
    ? (nodeIndex.current.get(activeId) as PageNode | undefined)
    : undefined;

  // While dragging, track the real cursor against each row's rect to decide the
  // drop point. This is more precise than collision on a static (non-reflowing)
  // list, so "between" follows the cursor exactly and never guesses.
  useEffect(() => {
    if (!activeId) return;
    const handle = (ev: PointerEvent) => {
      const { clientX: x, clientY: y } = ev;
      let next: Drop | null = null;
      for (const el of Array.from(document.querySelectorAll('.nav-row[data-page="1"]'))) {
        const id = el.getAttribute('data-id');
        if (!id || id === activeId) continue;
        const r = el.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) {
          const edge: 'above' | 'below' = y < r.top + r.height / 2 ? 'above' : 'below';
          const nest = x - dragStartX.current > NEST_DELTA;
          next = { overId: id, edge, nest };
          break;
        }
      }
      setDrop((prev) =>
        prev && next && prev.overId === next.overId && prev.edge === next.edge && prev.nest === next.nest
          ? prev
          : next,
      );
    };
    document.addEventListener('pointermove', handle);
    return () => document.removeEventListener('pointermove', handle);
  }, [activeId]);

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    const src = e.activatorEvent as PointerEvent | undefined;
    dragStartX.current = src?.clientX ?? 0;
    setDrop(null);
  }
  function resetDrag() {
    setActiveId(null);
    setDrop(null);
  }
  function onDragEnd() {
    const dragged = activeId;
    const d = drop;
    resetDrag();
    if (!dragged || !d) return; // dropped nowhere useful → snap back (dnd-kit)
    const draggedRow = pageRows.find((p) => p.node.id === dragged);
    const overRow = pageRows.find((p) => p.node.id === d.overId);
    if (!draggedRow || !overRow) return;

    if (d.nest) {
      void doMove(dragged, overRow.node.id, 0); // become first child of the target
      return;
    }

    // Sibling insertion at the target's level.
    const parentId = overRow.parentId;
    const group = pageRows.filter((p) => p.parentId === parentId).map((p) => p.node.id);
    const without = group.filter((id) => id !== dragged);
    const insertAt =
      d.edge === 'above' ? without.indexOf(d.overId) : without.indexOf(d.overId) + 1;
    // Skip a move that wouldn't change anything.
    const nextOrder = [...without.slice(0, insertAt), dragged, ...without.slice(insertAt)];
    if (draggedRow.parentId === parentId && nextOrder.join() === group.join()) return;
    void doMove(dragged, parentId, Math.max(0, insertAt));
  }

  function SortableRow({ row }: { row: PageRow }) {
    const node = row.node;
    const canDrag = reorg.has(node.spaceId);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: node.id,
      disabled: !canDrag,
    });
    const isActive =
      pathname === `/pages/${node.id}` ||
      (!!node.shortId && !!pathname && pathname.startsWith('/p/') && pathname.endsWith(`-${node.shortId}`));
    const isOpen = openPath.includes(node.id);
    const isLoading = loading.has(node.id);
    const depth = (soloSpace ? 0 : 1) + row.depth;

    const targeted = drop?.overId === node.id ? drop : null;
    const nestTarget = Boolean(targeted?.nest);
    const line = targeted && !targeted.nest ? targeted.edge : null;

    return (
      <div
        ref={setNodeRef}
        data-page="1"
        data-id={node.id}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuTarget({
            kind: 'page',
            id: node.id,
            title: node.title,
            spaceId: node.spaceId,
            hasChildren: node.hasChildren,
            canReorganize: reorg.has(node.spaceId),
            canEditSpace: false,
            x: e.clientX,
            y: e.clientY,
          });
        }}
        className={`nav-row${isActive ? ' active' : ''}${isDragging ? ' is-dragging' : ''}${
          nestTarget ? ' nest-target' : ''
        }${line === 'above' ? ' drop-above' : ''}${line === 'below' ? ' drop-below' : ''}${
          menuTarget?.id === node.id ? ' ctx-active' : ''
        }`}
        style={{
          paddingLeft: 6 + depth * INDENT,
          ['--drop-indent' as string]: `${6 + depth * INDENT}px`,
          transform: CSS.Translate.toString(transform),
          transition,
        }}
      >
        {node.hasChildren ? (
          <button
            className="nav-chevron"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            onClick={() => toggle(node, row.ancestors)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="nav-chevron-spacer" />
        )}
        <button
          className="nav-label"
          onClick={() => router.push(pageUrl(node))}
          {...(canDrag ? { ...attributes, ...listeners } : {})}
        >
          <AppIcon icon={node.icon || 'ms:description'} className="nav-icon nav-icon-page" size={18} />
          <span className="nav-text">{node.title}</span>
          {node.status !== 'published' && <span className="nav-dot" title={node.status} />}
        </button>
        {isOpen && isLoading && <span className="nav-inline-muted">…</span>}
      </div>
    );
  }

  function SpaceHeader({ row }: { row: SpaceRow }) {
    const node = row.node;
    const isOpen = openPath.includes(node.id);
    return (
      <div
        className={`nav-row nav-row-space${menuTarget?.id === node.id ? ' ctx-active' : ''}`}
        style={{ paddingLeft: 6 }}
        onContextMenu={(e) => {
          // Always suppress the browser menu on a space row. Only open our menu
          // when there's something to show — Edit space (global admin) or
          // Sort pages A–Z (space admin).
          e.preventDefault();
          const canReorganize = reorg.has(node.id);
          if (!isGlobalAdmin && !canReorganize) return;
          setMenuTarget({
            kind: 'space',
            id: node.id,
            title: node.name,
            spaceId: node.id,
            hasChildren: true,
            canReorganize,
            canEditSpace: isGlobalAdmin,
            x: e.clientX,
            y: e.clientY,
          });
        }}
      >
        <button
          className="nav-chevron"
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          onClick={() => toggle(node, row.ancestors)}
        >
          {isOpen ? '▾' : '▸'}
        </button>
        <button className="nav-label" onClick={() => openSpace(node, row.ancestors)}>
          <AppIcon icon={node.icon || 'folder'} className="nav-icon" size={20} />
          <span className="nav-text">{node.name}</span>
        </button>
      </div>
    );
  }

  if (roots === null) return <div className="nav-muted">Loading…</div>;

  return (
    <div ref={rootRef} className={`nav-tree${activeId ? ' dragging' : ''}`}>
      <div className="nav-header">
        <span>{soloSpace ? soloSpace.name : 'Spaces'}</span>
      </div>
      {roots.length === 0 ? (
        <div className="nav-muted">No spaces available.</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={resetDrag}
        >
          {/* No reorder animation: items hold still, a ghost keeps the original slot
              and an explicit line shows the drop point. */}
          <SortableContext items={sortableIds} strategy={() => null}>
            {visibleRows.map((row) =>
              row.type === 'space' ? (
                <SpaceHeader key={row.node.id} row={row} />
              ) : (
                <SortableRow key={row.node.id} row={row} />
              ),
            )}
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeNode ? (
              <div className="nav-row nav-drag-overlay">
                <span className="nav-chevron-spacer" />
                <span className="nav-label">
                  <AppIcon
                    icon={activeNode.icon || 'ms:description'}
                    className="nav-icon nav-icon-page"
                    size={18}
                  />
                  <span className="nav-text">{activeNode.title}</span>
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {menuTarget && <NavPageMenu target={menuTarget} onClose={() => setMenuTarget(null)} />}
    </div>
  );
}
