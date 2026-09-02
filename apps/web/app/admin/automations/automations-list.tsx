'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Automation, AutomationRun } from '../../../lib/api';
import { RunBadge } from './run-badge';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

const TRIGGER_LABEL: Record<string, string> = {
  page_event: 'Page event',
  schedule: 'Schedule',
  webhook: 'Webhook',
};

export function AutomationsList({
  automations,
  lastRun,
}: {
  automations: Automation[];
  lastRun: Record<string, AutomationRun>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Automation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(a: Automation) {
    setBusy(a.id);
    setError(null);
    try {
      const res = await fetch(`/api/bff/admin/automations/${a.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify({ enabled: !a.enabled }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Toggle failed.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(a: Automation) {
    setBusy(a.id);
    setError(null);
    try {
      const res = await fetch(`/api/bff/admin/automations/${a.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': await csrf() },
      });
      if (!res.ok && res.status !== 204) {
        setError('Delete failed.');
        return;
      }
      setConfirmDelete(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!automations.length) {
    return (
      <div className="empty-state">
        <span className="material-symbols-outlined">smart_toy</span>
        <p style={{ margin: '0.5rem 0 0', fontWeight: 600 }}>All quiet in here.</p>
        <p style={{ margin: '0.15rem 0 0', color: 'var(--color-text-muted)' }}>
          No automations yet — create your first to put the robots to work.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && <div className="form-error">{error}</div>}
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Trigger</th>
            <th>Enabled</th>
            <th>Last run</th>
            <th>Timeout</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {automations.map((a) => {
            const run = lastRun[a.id];
            return (
              <tr key={a.id}>
                <td>
                  <Link href={`/admin/automations/${a.id}`} style={{ fontWeight: 600 }}>
                    {a.name}
                  </Link>
                  {a.description && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{a.description}</div>
                  )}
                </td>
                <td>
                  {TRIGGER_LABEL[a.triggerType] ?? a.triggerType}
                  {a.triggerType === 'webhook' && a.webhookSlug && (
                    <div className="mono" style={{ fontSize: '0.75rem' }}>/hooks/{a.webhookSlug}</div>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className={a.enabled ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '0.15rem 0.7rem', fontSize: '0.78rem' }}
                    disabled={busy === a.id}
                    onClick={() => void toggle(a)}
                  >
                    {a.enabled ? 'On' : 'Off'}
                  </button>
                </td>
                <td>
                  {run ? (
                    <Link href={`/admin/automations/runs/${run.id}`}>
                      <RunBadge status={run.status} />
                    </Link>
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                  )}
                </td>
                <td className="mono" style={{ fontSize: '0.8rem' }}>{a.timeoutMs / 1000}s</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link className="btn-secondary" style={{ marginRight: 6 }} href={`/admin/automations/${a.id}/runs`}>
                    Runs
                  </Link>
                  <button type="button" className="btn-danger" disabled={busy === a.id} onClick={() => setConfirmDelete(a)}>
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">Delete “{confirmDelete.name}”?</div>
            <div className="modal-body">
              <p>This removes the automation and its entire run history. It cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </button>
                <button className="btn-danger" disabled={busy === confirmDelete.id} onClick={() => void remove(confirmDelete)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
