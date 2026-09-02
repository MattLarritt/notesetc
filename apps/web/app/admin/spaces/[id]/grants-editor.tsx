'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AdminGroup, AdminUser, Grant } from '../../../../lib/api';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

const ROLE_LABEL: Record<string, string> = {
  viewer: 'Viewer (read)',
  editor: 'Editor (read + write)',
  space_admin: 'Space Admin (+ reorganize + permissions)',
};

export function GrantsEditor({
  spaceId,
  grants,
  users,
  groups,
}: {
  spaceId: string;
  grants: Grant[];
  users: AdminUser[];
  groups: AdminGroup[];
}) {
  const router = useRouter();
  const [principalType, setPrincipalType] = useState<'user' | 'group'>('group');
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor' | 'space_admin'>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userById = new Map(users.map((u) => [u.id, u]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const grantedUsers = new Set(grants.filter((g) => g.principalType === 'user').map((g) => g.principalId));
  const grantedGroups = new Set(grants.filter((g) => g.principalType === 'group').map((g) => g.principalId));
  const availableUsers = users.filter((u) => !grantedUsers.has(u.id));
  // Administrators are global admins (they bypass space grants), so don't offer them here.
  const availableGroups = groups.filter((g) => g.kind !== 'administrators' && !grantedGroups.has(g.id));

  function principalLabel(g: Grant): string {
    if (g.principalType === 'user') return userById.get(g.principalId)?.email ?? g.principalId;
    return groupById.get(g.principalId)?.name ?? `group:${g.principalId}`;
  }

  async function add() {
    if (!principalId) return;
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/spaces/${spaceId}/grants`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ principalType, principalId, role }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not add grant.');
        return;
      }
      setPrincipalId('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(grantId: string, newRole: string) {
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/spaces/${spaceId}/grants/${grantId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not update role.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(grantId: string) {
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/spaces/${spaceId}/grants/${grantId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '1.5rem', maxWidth: 680 }}>
      <h3>Permissions</h3>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
        Grant a user or group a role on this space. Viewers read; Editors write pages; Space Admins
        also reorganize the page tree and manage these permissions. Grant <strong>All Users</strong>{' '}
        a role to apply it to everyone.
      </p>

      {grants.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          No grants yet — only global admins can access this space.
        </p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Type</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id}>
                <td className="mono">{principalLabel(g)}</td>
                <td>{g.principalType === 'group' ? 'Group' : 'User'}</td>
                <td>
                  <select
                    className="field"
                    style={{ maxWidth: 150 }}
                    value={g.role}
                    disabled={busy}
                    onChange={(e) => changeRole(g.id, e.target.value)}
                    title={ROLE_LABEL[g.role]}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="space_admin">Space Admin</option>
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn-secondary" disabled={busy} onClick={() => remove(g.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Grant to</span>
          <select
            className="field"
            value={principalType}
            onChange={(e) => {
              setPrincipalType(e.target.value as 'user' | 'group');
              setPrincipalId('');
            }}
          >
            <option value="group">Group</option>
            <option value="user">User</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.25rem', flex: 1, minWidth: 200 }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            {principalType === 'group' ? 'Group' : 'User'}
          </span>
          <select className="field" value={principalId} onChange={(e) => setPrincipalId(e.target.value)}>
            <option value="">Select…</option>
            {principalType === 'group'
              ? availableGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))
              : availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Role</span>
          <select className="field" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="space_admin">Space Admin</option>
          </select>
        </label>
        <button className="btn-primary" disabled={busy || !principalId} onClick={add}>
          Add
        </button>
      </div>
      {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
    </div>
  );
}
