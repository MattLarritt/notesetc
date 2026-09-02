'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { IconPicker } from '../../components/icon-picker';
import { refreshNav } from '../../../lib/nav-refresh';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

export function CreateSpace() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch('/api/bff/spaces', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({
          key,
          name,
          description: description || undefined,
          icon: icon || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; errors?: { message: string }[] };
        setError(body.errors?.[0]?.message ?? body.message ?? 'Could not create space.');
        return;
      }
      setKey('');
      setName('');
      setDescription('');
      setOpen(false);
      refreshNav();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        ＋ New space
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>New space</strong>
              <button type="button" className="tb-btn" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <form className="modal-body" onSubmit={submit} style={{ display: 'grid', gap: '0.7rem' }}>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Key (short, UPPERCASE)</span>
        <input
          className="field"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="ENG"
          required
        />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" required />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Description</span>
        <input
          className="field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What lives in this space?"
        />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Icon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </label>
      <p className="settings-hint" style={{ margin: 0 }}>
        New spaces are private. Use <strong>Permissions</strong> after creating to grant access —
        add <strong>All Users</strong> for everyone signed in, or <strong>Public</strong> for anyone.
      </p>
              {error && <div className="form-error">{error}</div>}
              <div className="page-actions">
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Creating…' : 'Create space'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
