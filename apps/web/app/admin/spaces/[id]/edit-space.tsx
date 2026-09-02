'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import type { Space } from '../../../../lib/api';
import { IconPicker } from '../../../components/icon-picker';
import { refreshNav } from '../../../../lib/nav-refresh';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

export function EditSpace({ space }: { space: Space }) {
  const router = useRouter();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description ?? '');
  const [icon, setIcon] = useState<string | null>(space.icon);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/spaces/${space.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ name, description: description || undefined, icon }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Save failed.');
        return;
      }
      setMsg('Saved.');
      refreshNav();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={save} style={{ display: 'grid', gap: '0.7rem', maxWidth: 560 }}>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Key</span>
        <input className="field" value={space.key} disabled />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          The key is permanent and can’t be changed.
        </span>
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Description</span>
        <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Icon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </label>
      {error && <div className="form-error">{error}</div>}
      {msg && <div style={{ color: '#2f7a43', fontSize: '0.88rem' }}>{msg}</div>}
      <div className="page-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
