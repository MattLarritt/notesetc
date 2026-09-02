'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { AdminGroup, AdminUser } from '../../../lib/api';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

interface Member {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

const KIND_LABEL: Record<AdminGroup['kind'], string> = {
  administrators: 'System · admins',
  all_users: 'System · everyone',
  // Grants on Public apply to anonymous visitors too, not just signed-in users.
  public: 'System · anyone',
  custom: 'Group',
};

export function GroupsManager({ groups, users }: { groups: AdminGroup[]; users: AdminUser[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function createGroup() {
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch('/api/bff/admin/groups', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not create group.');
        return;
      }
      setName('');
      setDescription('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(id: string) {
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/admin/groups/${id}`, {
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
    <div style={{ maxWidth: 720 }}>
      {/* Create */}
      <div className="card" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: '0.25rem', flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>New group name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Service Desk" />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem', flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Description (optional)</span>
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={createGroup}>
          Create group
        </button>
      </div>
      {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}

      {/* List */}
      <div style={{ marginTop: '1.25rem', display: 'grid', gap: '0.6rem' }}>
        {groups.map((g) => (
          <div key={g.id} className="card" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <strong>{g.name}</strong>
                  <span className={`badge ${g.system ? 'published' : ''}`}>{KIND_LABEL[g.kind]}</span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                    {g.memberCount} member{g.memberCount === 1 ? '' : 's'}
                  </span>
                </div>
                {g.description && (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                    {g.description}
                  </div>
                )}
              </div>
              <button
                className="btn-secondary"
                onClick={() => setOpenId(openId === g.id ? null : g.id)}
              >
                {openId === g.id ? 'Hide members' : 'Members'}
              </button>
              {!g.system && (
                <button className="btn-secondary" disabled={busy} onClick={() => deleteGroup(g.id)}>
                  Delete
                </button>
              )}
            </div>
            {openId === g.id && <MemberEditor group={g} users={users} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemberEditor({ group, users }: { group: AdminGroup; users: AdminUser[] }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bff/admin/groups/${group.id}/members`, { credentials: 'include' });
    const { data } = (await res.json()) as { data: Member[] };
    setMembers(data ?? []);
  }, [group.id]);

  // Load members once when the editor opens.
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!addId) return;
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/admin/groups/${group.id}/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ userId: addId }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not add member.');
        return;
      }
      setAddId('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/admin/groups/${group.id}/members/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (!res.ok && res.status !== 204) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not remove member.');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set((members ?? []).map((m) => m.id));
  const candidates = users.filter((u) => u.status === 'active' && !memberIds.has(u.id));

  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
      {group.kind === 'all_users' ? (
        <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
          Everyone is a member of All Users — membership can’t be edited.
        </p>
      ) : (
        <>
          {members === null ? (
            <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
          ) : members.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No members yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.6rem', display: 'grid', gap: '0.3rem' }}>
              {members.map((m) => (
                <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ flex: 1 }}>
                    {m.displayName} <span className="mono" style={{ color: 'var(--color-text-muted)' }}>{m.email}</span>
                  </span>
                  <button className="btn-secondary" disabled={busy} onClick={() => remove(m.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: '0.25rem', flex: 1 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                {group.kind === 'administrators' ? 'Make a user an administrator' : 'Add member'}
              </span>
              <select className="field" value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">Select a user…</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-primary" disabled={busy || !addId} onClick={add}>
              Add
            </button>
          </div>
          {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
        </>
      )}
    </div>
  );
}
