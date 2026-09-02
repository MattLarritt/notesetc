'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Top-right account menu: a user icon that opens a dropdown with My maintenance,
 * Admin portal (admins only) and Sign out. A badge on the icon counts maintenance
 * items due within 30 days — red when any are overdue, amber when merely due soon.
 */
export function UserMenu({
  email,
  isAdmin,
  dueCount,
  hasOverdue,
}: {
  email: string;
  isAdmin: boolean;
  dueCount: number;
  hasOverdue: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      const csrfRes = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
      const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
      await fetch('/api/bff/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': csrfToken },
      });
      // Same reasoning as sign-in: session changed, so bypass the RSC cache.
      window.location.assign('/login');
    } finally {
      setBusy(false);
    }
  }

  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="material-symbols-outlined">account_circle</span>
        {dueCount > 0 && (
          <span className={`user-badge${hasOverdue ? ' overdue' : ''}`}>{dueCount > 99 ? '99+' : dueCount}</span>
        )}
      </button>

      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="user-menu-head">
            <span className="material-symbols-outlined">account_circle</span>
            <span className="user-menu-email" title={email}>{email}</span>
          </div>
          <div className="user-menu-sep" />
          <button className="user-menu-item" role="menuitem" onClick={() => go('/maintenance')}>
            <span>My maintenance</span>
            {dueCount > 0 && (
              <span className={`user-badge inline${hasOverdue ? ' overdue' : ''}`}>{dueCount > 99 ? '99+' : dueCount}</span>
            )}
          </button>
          {isAdmin && (
            <button className="user-menu-item" role="menuitem" onClick={() => go('/admin')}>
              Admin portal
            </button>
          )}
          <div className="user-menu-sep" />
          <button className="user-menu-item danger" role="menuitem" disabled={busy} onClick={signOut}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
