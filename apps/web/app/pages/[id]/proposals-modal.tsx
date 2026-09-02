'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export interface ProposalModalItem {
  id: string;
  status: 'open' | 'approved' | 'rejected' | 'superseded';
  originLabel: string;
  aiAgentLabel: string | null;
  createdAt: string;
  rationale: string | null;
  proposedTitle: string | null;
  /** Pre-sanitized HTML of the proposed content (rendered server-side). */
  contentHtml: string;
}

/** Proposals modal: review (approve/reject) suggested changes without leaving the page. */
export function ProposalsModal({
  pageId,
  proposals,
  canReview,
  canPropose,
  openCount,
  triggerClass,
  triggerLabel = 'Proposals',
}: {
  pageId: string;
  proposals: ProposalModalItem[];
  canReview: boolean;
  canPropose: boolean;
  openCount: number;
  triggerClass: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function act(proposalId: string, action: 'approve' | 'reject') {
    setError(null);
    setBusy(true);
    try {
      const c = await (await fetch('/api/bff/auth/csrf', { credentials: 'include' })).json();
      const res = await fetch(`/api/bff/proposals/${proposalId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': c.csrfToken },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? `Failed to ${action}.`);
        return;
      }
      router.refresh(); // re-renders the server component; proposals prop updates
    } finally {
      setBusy(false);
    }
  }

  const badgeClass = (s: ProposalModalItem['status']) =>
    s === 'open' ? 'draft' : s === 'approved' ? 'published' : 'archived';

  return (
    <>
      <button type="button" className={triggerClass} onClick={() => setOpen(true)}>
        {triggerLabel}
        {openCount > 0 && <span className="proposal-count">{openCount}</span>}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" style={{ width: 'min(760px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Proposals</strong>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {canPropose && (
                  <a className="btn-secondary" href={`/pages/${pageId}/propose`} style={{ textDecoration: 'none' }}>
                    Propose a change
                  </a>
                )}
                <button className="tb-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
              </div>
            </div>
            <div className="modal-body">
              {error && <div className="form-error">{error}</div>}
              {proposals.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)' }}>No proposals yet.</p>
              ) : (
                proposals.map((p) => (
                  <div key={p.id} className="card" style={{ marginTop: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div>
                        <span className={`badge ${badgeClass(p.status)}`}>{p.status}</span>
                        <span style={{ marginLeft: 8, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                          {p.originLabel}{p.aiAgentLabel ? ` · ${p.aiAgentLabel}` : ''} · {new Date(p.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {p.status === 'open' && canReview && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn-primary" disabled={busy} onClick={() => act(p.id, 'approve')}>Approve</button>
                          <button className="btn-secondary" disabled={busy} onClick={() => act(p.id, 'reject')}>Reject</button>
                        </div>
                      )}
                    </div>
                    {p.rationale && <p style={{ marginTop: '0.6rem' }}><strong>Rationale:</strong> {p.rationale}</p>}
                    {p.proposedTitle && <p style={{ fontSize: '0.9rem' }}><strong>New title:</strong> {p.proposedTitle}</p>}
                    <details style={{ marginTop: '0.5rem' }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--color-link)' }}>Proposed content</summary>
                      <div
                        className="prose"
                        style={{ marginTop: '0.5rem', borderLeft: '3px solid var(--color-border)', paddingLeft: '1rem' }}
                        dangerouslySetInnerHTML={{ __html: p.contentHtml }}
                      />
                    </details>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
