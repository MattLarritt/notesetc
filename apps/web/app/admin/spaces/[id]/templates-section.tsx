'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TemplateSummary } from '../../../../lib/api';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

export function TemplatesSection({
  spaceId,
  templates,
  defaultTemplateId,
}: {
  spaceId: string;
  templates: TemplateSummary[];
  defaultTemplateId: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/spaces/${spaceId}/templates`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not create template.');
        return;
      }
      const created = (await res.json()) as { id: string };
      // Jump straight into the editor to fill it out.
      router.push(`/admin/spaces/${spaceId}/templates/${created.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/templates/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (res.ok || res.status === 204) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(id: string) {
    setBusy(true);
    try {
      const token = await csrf();
      await fetch(`/api/bff/spaces/${spaceId}/default-template`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ templateId: id || null }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '1.5rem', maxWidth: 640 }}>
      <h3>Templates</h3>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
        Reusable starter content for new pages. Set a space default, or assign a template to a page
        (from that page) so its subpages start from it.
      </p>

      {templates.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No templates yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Space default</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/admin/spaces/${spaceId}/templates/${t.id}`}>{t.name}</Link>
                </td>
                <td>
                  {defaultTemplateId === t.id ? (
                    <span className="badge published">Default</span>
                  ) : (
                    <button className="btn-secondary" disabled={busy} onClick={() => setDefault(t.id)}>
                      Set default
                    </button>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/admin/spaces/${spaceId}/templates/${t.id}`} className="btn-secondary" style={{ marginRight: 6 }}>
                    Edit
                  </Link>
                  <button className="btn-secondary" disabled={busy} onClick={() => remove(t.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {defaultTemplateId && (
        <button className="btn-secondary" disabled={busy} onClick={() => setDefault('')} style={{ marginTop: '0.5rem' }}>
          Clear space default
        </button>
      )}

      <div className="card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginTop: '1rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', flex: 1 }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>New template name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Application runbook" />
        </label>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
          Create & edit
        </button>
      </div>
      {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
    </div>
  );
}
