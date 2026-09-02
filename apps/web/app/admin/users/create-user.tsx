'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@notesetc/shared';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

export function CreateUser() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch('/api/bff/admin/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ email, displayName, password, globalRole: 'member' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; errors?: { message: string }[] };
        setError(body.errors?.[0]?.message ?? body.message ?? 'Could not create user.');
        return;
      }
      setEmail('');
      setDisplayName('');
      setPassword('');
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        ＋ New user
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>New local user</strong>
              <button type="button" className="tb-btn" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <form className="modal-body" onSubmit={submit} style={{ display: 'grid', gap: '0.7rem' }}>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Email</span>
        <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Display name</span>
        <input className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label style={{ display: 'grid', gap: '0.25rem' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
          Temporary password (min {MIN_PASSWORD_LENGTH} chars)
        </span>
        <input
          className="field"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
        />
      </label>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
        New users start as members. To grant admin rights, add them to the{' '}
        <strong>Administrators</strong> group under Groups.
      </p>
              {error && <div className="form-error">{error}</div>}
              <div className="page-actions">
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Creating…' : 'Create user'}
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
