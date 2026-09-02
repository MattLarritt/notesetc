'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { refreshNav } from '../../lib/nav-refresh';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { credentials: 'include' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface MenuTarget {
  kind: 'page' | 'space';
  id: string;
  title: string;
  spaceId: string;
  hasChildren: boolean;
  /** Space-admin on the relevant space — gates Move/Delete/Sort. */
  canReorganize: boolean;
  /** Global admin — gates "Edit space" (its settings page is admin-only). */
  canEditSpace: boolean;
  x: number;
  y: number;
}

type SpaceLite = { id: string; key: string; name: string; canReorganize?: boolean };
type PageLite = { id: string; title: string; parentId: string | null; position: number };
type Grant = { principalType: string; principalId: string; role: string };

/** Right-click menu for a nav page + its Rename / Move / Delete modals. */
export function NavPageMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<'menu' | 'rename' | 'move' | 'delete'>('menu');

  // Open at the cursor; only nudge back on-screen by the menu's *actual* size.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: target.x, y: target.y });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const x = Math.max(pad, Math.min(target.x, window.innerWidth - width - pad));
    const y = Math.max(pad, Math.min(target.y, window.innerHeight - height - pad));
    setPos((p) => (p.x === x && p.y === y ? p : { x, y }));
  }, [target.x, target.y, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = () => { refreshNav(); router.refresh(); onClose(); };

  async function sortAlphabetical() {
    const path = target.kind === 'space'
      ? `/api/bff/spaces/${target.id}/sort-pages`
      : `/api/bff/pages/${target.id}/sort-children`;
    onClose();
    const token = await csrf();
    await fetch(path, { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': token } });
    refreshNav();
    router.refresh();
  }

  if (mode === 'menu') {
    return (
      <>
        <div className="ctx-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
        <div ref={menuRef} className="ctx-menu" style={{ left: pos.x, top: pos.y }} role="menu">
          {target.kind === 'space' ? (
            <>
              {target.canEditSpace && (
                <button className="ctx-item" onClick={() => { onClose(); router.push(`/admin/spaces/${target.id}`); }}>
                  <span className="material-symbols-outlined">settings</span> Edit space
                </button>
              )}
              {target.canReorganize && (
                <button className="ctx-item" onClick={sortAlphabetical}>
                  <span className="material-symbols-outlined">sort_by_alpha</span> Sort pages A–Z
                </button>
              )}
            </>
          ) : (
            <>
              <button className="ctx-item" onClick={() => { onClose(); router.push(`/pages/${target.id}/edit`); }}>
                <span className="material-symbols-outlined">edit</span> Edit
              </button>
              <button className="ctx-item" onClick={() => setMode('move')}>
                <span className="material-symbols-outlined">drive_file_move</span> Move…
              </button>
              <button className="ctx-item" onClick={() => setMode('rename')}>
                <span className="material-symbols-outlined">drive_file_rename_outline</span> Rename…
              </button>
              {target.hasChildren && target.canReorganize && (
                <button className="ctx-item" onClick={sortAlphabetical}>
                  <span className="material-symbols-outlined">sort_by_alpha</span> Sort subpages A–Z
                </button>
              )}
              <div className="ctx-sep" />
              <button className="ctx-item danger" onClick={() => setMode('delete')}>
                <span className="material-symbols-outlined">delete</span> Delete…
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  if (mode === 'rename') return <RenameModal target={target} onClose={onClose} onDone={done} />;
  if (mode === 'move') return <MoveModal target={target} onClose={onClose} onDone={done} />;
  return <DeleteModal target={target} onClose={onClose} onDone={done} />;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(460px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button className="tb-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function RenameModal({ target, onClose, onDone }: { target: MenuTarget; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(target.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/pages/${target.id}/rename`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Rename failed.');
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Rename page" onClose={onClose}>
      <label className="auth-field">
        <span>Title</span>
        <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      </label>
      {error && <div className="form-error" style={{ marginTop: '0.6rem' }}>{error}</div>}
      <div className="page-actions" style={{ marginTop: '0.9rem', justifyContent: 'flex-end' }}>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !title.trim()} onClick={save}>{busy ? 'Saving…' : 'Rename'}</button>
      </div>
    </Modal>
  );
}

function DeleteModal({ target, onClose, onDone }: { target: MenuTarget; onClose: () => void; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/pages/${target.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (!res.ok && res.status !== 204) {
        setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Delete failed.');
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete page" onClose={onClose}>
      <p style={{ marginTop: 0 }}>
        This permanently deletes <strong>{target.title}</strong>
        {target.hasChildren ? <> and <strong>all of its subpages</strong></> : null}, including their
        full history. This <strong>cannot be undone</strong>.
      </p>
      <label className="confirm-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          Yes, permanently delete this page{target.hasChildren ? ' and everything under it' : ''}.
        </span>
      </label>
      {error && <div className="form-error" style={{ marginTop: '0.6rem' }}>{error}</div>}
      <div className="page-actions" style={{ marginTop: '0.9rem', justifyContent: 'flex-end' }}>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-danger" disabled={busy || !ack} onClick={remove}>{busy ? 'Deleting…' : 'Delete page'}</button>
      </div>
    </Modal>
  );
}

function MoveModal({ target, onClose, onDone }: { target: MenuTarget; onClose: () => void; onDone: () => void }) {
  const [spaces, setSpaces] = useState<SpaceLite[] | null>(null);
  const [spaceId, setSpaceId] = useState(target.spaceId);
  const [pages, setPages] = useState<PageLite[] | null>(null);
  const [parentId, setParentId] = useState<string>(''); // '' = top level
  const [permWarn, setPermWarn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Spaces the caller can reorganize (admin) are valid move targets.
  useEffect(() => {
    getJson<{ data: SpaceLite[] }>('/api/bff/spaces').then((r) =>
      setSpaces((r?.data ?? []).filter((s) => s.canReorganize)),
    );
  }, []);

  // Load the chosen space's pages (for the parent picker) + permission diff.
  useEffect(() => {
    setPages(null);
    setParentId('');
    getJson<{ data: PageLite[] }>(`/api/bff/spaces/${spaceId}/pages`).then((r) => setPages(r?.data ?? []));
    if (spaceId === target.spaceId) {
      setPermWarn(false);
      return;
    }
    // Different space → compare grant sets to decide whether to warn.
    (async () => {
      const key = (g: Grant) => `${g.principalType}:${g.principalId}:${g.role}`;
      const [src, dst] = await Promise.all([
        getJson<{ data: Grant[] }>(`/api/bff/spaces/${target.spaceId}/grants`),
        getJson<{ data: Grant[] }>(`/api/bff/spaces/${spaceId}/grants`),
      ]);
      const s = new Set((src?.data ?? []).map(key));
      const d = new Set((dst?.data ?? []).map(key));
      const differ = s.size !== d.size || [...s].some((k) => !d.has(k));
      setPermWarn(differ);
    })();
  }, [spaceId, target.spaceId]);

  // Exclude the page itself + its descendants from parent options (same-space move).
  const descendants = useMemo(() => {
    const set = new Set<string>();
    if (spaceId !== target.spaceId || !pages) return set;
    set.add(target.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of pages) {
        if (p.parentId && set.has(p.parentId) && !set.has(p.id)) { set.add(p.id); changed = true; }
      }
    }
    return set;
  }, [pages, spaceId, target.id, target.spaceId]);

  // Flatten pages into an indented, ordered list for the parent <select>.
  const parentOptions = useMemo(() => {
    if (!pages) return [];
    const byParent = new Map<string | null, PageLite[]>();
    for (const p of pages) {
      const k = p.parentId;
      byParent.set(k, [...(byParent.get(k) ?? []), p]);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    const out: { id: string; label: string }[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const p of byParent.get(pid) ?? []) {
        if (descendants.has(p.id)) continue; // can't move under self/descendant
        out.push({ id: p.id, label: `${'  '.repeat(depth)}${p.title}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [pages, descendants]);

  const currentSpaceName = spaces?.find((s) => s.id === target.spaceId)?.name ?? 'this space';
  const targetSpaceName = spaces?.find((s) => s.id === spaceId)?.name ?? '';

  async function move() {
    setBusy(true);
    setError(null);
    try {
      const token = await csrf();
      const body: Record<string, unknown> = { position: 1_000_000 };
      if (parentId) body.parentId = parentId;
      else { body.parentId = null; body.spaceId = spaceId; }
      const res = await fetch(`/api/bff/pages/${target.id}/move`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Move failed.');
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Move “${target.title}”`} onClose={onClose}>
      {!spaces ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : (
        <>
          <p className="settings-hint" style={{ marginTop: 0 }}>
            Moving a page takes its subpages with it.
          </p>
          <label className="auth-field" style={{ marginBottom: '0.7rem' }}>
            <span>Destination space</span>
            <select className="field" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.id === target.spaceId ? ' (current)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Place under</span>
            <select className="field" value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={!pages}>
              <option value="">Top level of {targetSpaceName || 'space'}</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>

          {permWarn && (
            <div className="callout warning" style={{ marginTop: '0.9rem' }}>
              <strong>Different permissions.</strong> “{targetSpaceName}” doesn’t share “{currentSpaceName}”’s
              access list. After moving, this page and its subpages follow “{targetSpaceName}”’s permissions —
              some people may gain or lose access.
            </div>
          )}
          {error && <div className="form-error" style={{ marginTop: '0.6rem' }}>{error}</div>}

          <div className="page-actions" style={{ marginTop: '0.9rem', justifyContent: 'flex-end' }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={move}>{busy ? 'Moving…' : 'Move here'}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
