'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

export function UserActions({
  userId,
  status,
  isBreakglass,
  isSelf,
}: {
  userId: string;
  status: 'active' | 'disabled';
  isBreakglass: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/admin/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        alert(b.message ?? 'Update failed.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // The breakglass account is managed via env; no portal actions.
  if (isBreakglass) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>env-managed</span>;

  return (
    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
      <button
        className="btn-secondary"
        disabled={busy || isSelf}
        onClick={() => patch({ status: status === 'active' ? 'disabled' : 'active' })}
      >
        {status === 'active' ? 'Disable' : 'Enable'}
      </button>
    </div>
  );
}
