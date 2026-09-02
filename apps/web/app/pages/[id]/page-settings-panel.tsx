'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { refreshNav } from '../../../lib/nav-refresh';
import type { MaintenanceInfo, PageCapabilities, ReviewStatus, TemplateSummary } from '../../../lib/api';
import { HistoryModal } from './history-modal';
import { ProposalsModal, type ProposalModalItem } from './proposals-modal';
import { CommentsModal } from './comments-modal';
import type { RenderedComment } from './comment-render';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

const STATUS_LABEL: Record<ReviewStatus, { text: string; bg: string; color: string }> = {
  none: { text: 'No schedule', bg: 'var(--nav-bg)', color: 'var(--color-text-muted)' },
  ok: { text: 'Up to date', bg: '#e6f4ea', color: '#1e7d34' },
  due_soon: { text: 'Due soon', bg: '#fdf2e6', color: '#b8730b' },
  overdue: { text: 'Overdue', bg: '#fdeaea', color: '#c0392b' },
};

/** The editor's right-hand "Page settings" console: status, subpage template, maintenance. */
export function PageSettingsPanel({
  pageId,
  spaceId,
  parentId,
  title,
  status,
  currentVersionId,
  capabilities: can,
  maintenance,
  templates,
  childTemplateId,
  proposalItems,
  commentItems,
  canComment,
}: {
  pageId: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  status: 'draft' | 'published' | 'archived';
  currentVersionId: string | null;
  capabilities: PageCapabilities;
  maintenance: MaintenanceInfo;
  templates: TemplateSummary[];
  childTemplateId: string | null;
  proposalItems: ProposalModalItem[];
  commentItems: RenderedComment[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalDays] = useState(maintenance.reviewIntervalDays?.toString() ?? '');
  const [dueDate, setDueDate] = useState(maintenance.reviewDueAt ? maintenance.reviewDueAt.slice(0, 10) : '');
  const [ptype, setPtype] = useState<'user' | 'group'>('group');
  const [pid, setPid] = useState('');

  async function send(path: string, method: string, body?: unknown, nav = false) {
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok && res.status !== 204) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Request failed.');
        return false;
      }
      if (nav) refreshNav();
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete “${title}”, all its subpages, and their history? This cannot be undone.`)) return;
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/pages/${pageId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (!res.ok && res.status !== 204) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not delete this page.');
        return;
      }
      refreshNav();
      router.push(parentId ? `/pages/${parentId}` : `/spaces/${spaceId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const st = STATUS_LABEL[maintenance.status];
  const grantedIds = new Set(maintenance.maintainers.map((m) => m.principalId));
  const availUsers = (maintenance.assignable?.users ?? []).filter((u) => !grantedIds.has(u.id));
  const availGroups = (maintenance.assignable?.groups ?? []).filter((g) => !grantedIds.has(g.id));

  return (
    <div className="settings-panel">
      {/* Status */}
      {can.edit && (
        <section className="settings-sec">
          <h4>Status</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span className={`badge ${status}`}>{status}</span>
            {status !== 'published' && (
              <button className="btn-secondary" disabled={busy} onClick={() => send(`/pages/${pageId}/publish`, 'POST', undefined, true)}>
                Publish
              </button>
            )}
            {status !== 'archived' && (
              <button className="btn-secondary" disabled={busy} onClick={() => send(`/pages/${pageId}/archive`, 'POST', undefined, true)}>
                Archive
              </button>
            )}
          </div>
        </section>
      )}

      {/* Subpage template */}
      {can.manageTemplates && (
        <section className="settings-sec">
          <h4>Subpage template</h4>
          <p className="settings-hint">New subpages start from this template.</p>
          <select
            className="field"
            defaultValue={childTemplateId ?? ''}
            disabled={busy}
            onChange={(e) => send(`/pages/${pageId}/child-template`, 'PUT', { templateId: e.target.value || null })}
          >
            <option value="">None (default)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </section>
      )}

      {/* Maintenance */}
      <section className="settings-sec">
        <h4>Maintenance</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ background: st.bg, color: st.color, padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>
            {st.text}
          </span>
          {maintenance.reviewDueAt && <span className="settings-hint">due {new Date(maintenance.reviewDueAt).toLocaleDateString()}</span>}
        </div>
        <p className="settings-hint" style={{ marginTop: '0.35rem' }}>
          {maintenance.lastReviewedAt
            ? `Last reviewed ${new Date(maintenance.lastReviewedAt).toLocaleDateString()}${maintenance.lastReviewedByLabel ? ` · ${maintenance.lastReviewedByLabel}` : ''}`
            : 'Never reviewed'}
        </p>
        {maintenance.canReview && (
          <button className="btn-primary" disabled={busy} style={{ marginTop: '0.4rem' }} onClick={() => send(`/pages/${pageId}/maintenance/reviewed`, 'POST')}>
            ✓ Mark reviewed
          </button>
        )}

        {maintenance.canManage && (
          <>
            <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.7rem' }}>
              <label style={{ display: 'grid', gap: '0.2rem' }}>
                <span className="settings-label">Review every (days)</span>
                <input className="field" type="number" min={1} value={interval} onChange={(e) => setIntervalDays(e.target.value)} placeholder="e.g. 180" />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem' }}>
                <span className="settings-label">Next review date</span>
                <input className="field" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() =>
                  send(`/pages/${pageId}/maintenance`, 'PUT', {
                    intervalDays: interval ? Number(interval) : null,
                    dueAt: dueDate ? new Date(dueDate + 'T00:00:00').toISOString() : null,
                  })
                }
              >
                Save schedule
              </button>
            </div>

            <div style={{ marginTop: '0.7rem' }}>
              <span className="settings-label">Maintainers</span>
              {maintenance.maintainers.length === 0 ? (
                <p className="settings-hint" style={{ margin: '0.2rem 0' }}>None assigned.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0.3rem 0', display: 'grid', gap: '0.25rem' }}>
                  {maintenance.maintainers.map((m) => (
                    <li key={m.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.82rem' }}>
                      <span style={{ flex: 1 }}>{m.principalType === 'group' ? '👥 ' : '👤 '}{m.label}</span>
                      <button className="link-btn" disabled={busy} onClick={() => send(`/pages/${pageId}/maintainers/${m.id}`, 'DELETE')}>
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                <select className="field" value={ptype} onChange={(e) => { setPtype(e.target.value as 'user' | 'group'); setPid(''); }} style={{ width: 'auto' }}>
                  <option value="group">Group</option>
                  <option value="user">User</option>
                </select>
                <select className="field" value={pid} onChange={(e) => setPid(e.target.value)} style={{ flex: 1, width: 'auto', minWidth: 110 }}>
                  <option value="">Add…</option>
                  {(ptype === 'group' ? availGroups.map((g) => ({ id: g.id, label: g.name })) : availUsers.map((u) => ({ id: u.id, label: u.email }))).map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <button
                  className="btn-secondary"
                  disabled={busy || !pid}
                  onClick={async () => {
                    if (await send(`/pages/${pageId}/maintainers`, 'POST', { principalType: ptype, principalId: pid })) setPid('');
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Page actions */}
      <section className="settings-sec">
        <h4>Page</h4>
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          {can.createChild && (
            <Link className="settings-link" href={`/spaces/${spaceId}/new?parent=${pageId}`}>＋ Add subpage</Link>
          )}
          <HistoryModal
            pageId={pageId}
            currentVersionId={currentVersionId}
            canRestore={can.edit}
            triggerClass="settings-link"
          />
          <CommentsModal
            pageId={pageId}
            comments={commentItems}
            canComment={canComment}
            triggerClass="settings-link"
          />
          {(can.propose || can.review) && (
            <ProposalsModal
              pageId={pageId}
              proposals={proposalItems}
              canReview={can.review}
              canPropose={can.propose}
              openCount={proposalItems.filter((p) => p.status === 'open').length}
              triggerClass="settings-link"
            />
          )}
        </div>
      </section>

      {/* Danger zone */}
      {can.delete && (
        <section className="settings-sec">
          <h4 style={{ color: '#c0392b' }}>Danger zone</h4>
          <p className="settings-hint">Permanently deletes this page, all of its subpages, and their history. This cannot be undone.</p>
          <button className="btn-danger" disabled={busy} onClick={remove}>
            Delete page…
          </button>
        </section>
      )}

      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
