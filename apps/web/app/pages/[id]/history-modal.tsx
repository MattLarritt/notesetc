'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { refreshNav } from '../../../lib/nav-refresh';
import type { PageVersion } from '../../../lib/api';

/** Version-history modal: lists versions with inline restore, no page navigation. */
export function HistoryModal({
  pageId,
  currentVersionId,
  canRestore,
  triggerClass,
  triggerLabel = 'History',
}: {
  pageId: string;
  currentVersionId: string | null;
  canRestore: boolean;
  triggerClass: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setError(null);
    let cancelled = false;
    fetch(`/api/bff/pages/${pageId}/versions`, { credentials: 'include' })
      .then((r) => r.json())
      .then((b: { data?: PageVersion[] }) => { if (!cancelled) setVersions(b.data ?? []); })
      .catch(() => { if (!cancelled) setError('Could not load history.'); });
    return () => { cancelled = true; };
  }, [open, pageId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function restore(versionId: string) {
    if (!confirm('Restore this version? It becomes a new version at the top of history.')) return;
    setBusy(true);
    try {
      const c = await (await fetch('/api/bff/auth/csrf', { credentials: 'include' })).json();
      const res = await fetch(`/api/bff/pages/${pageId}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': c.csrfToken },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) { alert('Restore failed.'); return; }
      refreshNav();
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={triggerClass} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" style={{ width: 'min(760px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Version history</strong>
              <button className="tb-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="form-error">{error}</div>}
              {!versions ? (
                <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
              ) : versions.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)' }}>No versions yet.</p>
              ) : (
                <table className="prose" style={{ width: '100%' }}>
                  <thead>
                    <tr><th>Version</th><th>Summary</th><th>Author</th><th>When</th><th /></tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => {
                      const isCurrent = v.id === currentVersionId;
                      return (
                        <tr key={v.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            v{v.versionNumber} {isCurrent && <span className="badge published">current</span>}
                          </td>
                          <td>{v.changeSummary ?? '—'}</td>
                          <td>{v.aiAgentLabel ?? v.authorType}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{new Date(v.createdAt).toLocaleString()}</td>
                          <td>
                            {canRestore && !isCurrent && (
                              <button className="btn-secondary" disabled={busy} onClick={() => restore(v.id)}>
                                Restore
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
