'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { refreshNav } from '../../../lib/nav-refresh';

export function ArchiveToggle({ spaceId, status }: { spaceId: string; status: 'active' | 'archived' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const action = status === 'archived' ? 'unarchive' : 'archive';

  async function run() {
    setBusy(true);
    try {
      const cr = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
      const { csrfToken } = (await cr.json()) as { csrfToken: string };
      const res = await fetch(`/api/bff/spaces/${spaceId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!res.ok) {
        alert(`Could not ${action} space.`);
        return;
      }
      refreshNav();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn-secondary" disabled={busy} onClick={run}>
      {busy ? '…' : status === 'archived' ? 'Unarchive' : 'Archive'}
    </button>
  );
}
