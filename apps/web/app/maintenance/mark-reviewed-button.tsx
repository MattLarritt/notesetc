'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

/** Lets a maintainer mark a page reviewed straight from the portal, without
 *  opening the editor (maintainers aren't always editors). */
export function MarkReviewedButton({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function mark() {
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/pages/${pageId}/maintenance/reviewed`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        alert(body.message ?? 'Could not mark reviewed.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn-secondary" disabled={busy} onClick={mark} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>
      {busy ? '…' : '✓ Reviewed'}
    </button>
  );
}
