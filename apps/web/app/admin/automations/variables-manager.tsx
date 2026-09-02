'use client';

import { LockIcon } from '../../components/ai-icons';

import { useCallback, useEffect, useState } from 'react';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

interface Variable {
  name: string;
  isSecure: boolean;
  value: string | null; // null when secure (write-only)
  updatedAt: string;
}

/**
 * Manage automation variables (netc.variable). Secure values are write-only:
 * shown as •••• and can only be overwritten or deleted, never read back.
 * Without `automationId` this manages GLOBAL variables; with it, the variables
 * scoped to that one script (which shadow globals of the same name).
 */
export function VariablesManager({
  automationId,
  onChanged,
}: {
  automationId?: string;
  onChanged?: () => void;
} = {}) {
  const base = automationId
    ? `/api/bff/admin/automations/${automationId}/variables`
    : '/api/bff/admin/automations/variables';
  const [vars, setVars] = useState<Variable[] | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [isSecure, setIsSecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(base, { credentials: 'include' });
    if (res.ok) {
      const body = (await res.json()) as { data: Variable[] };
      setVars(body.data);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError(null);
    if (!name.trim() || !/^[A-Za-z0-9_.-]+$/.test(name)) {
      setError('Name must use letters, digits, _ . - only.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(name)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify({ value, isSecure }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Save failed.');
        return;
      }
      setName('');
      setValue('');
      setIsSecure(false);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function remove(n: string) {
    setBusy(true);
    try {
      await fetch(`${base}/${encodeURIComponent(n)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': await csrf() },
      });
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18, padding: '1rem 1.2rem' }}>
      <h3 style={{ marginTop: 0 }}>{automationId ? 'Script variables' : 'Global variables'}</h3>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.86rem', maxWidth: 700 }}>
        {automationId ? (
          <>
            Readable only by <b>this</b> script via <code>netc.variable(&apos;name&apos;)</code>; a
            script variable shadows a global one of the same name.{' '}
          </>
        ) : (
          <>
            Readable by <b>every</b> automation via <code>netc.variable(&apos;name&apos;)</code> —
            prefer script variables (on each automation&apos;s page) unless the value is shared.{' '}
          </>
        )}
        Mark API keys and passwords as <b>secure</b> — encrypted at rest, never readable back here
        (only replaced), redacted from run logs, and shown{' '}
        <span style={{ color: '#b23124', fontWeight: 700 }}>red</span> in the script editor.
      </p>

      {error && <div className="form-error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          className="field mono"
          style={{ width: 180 }}
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="field mono"
          style={{ flex: 1, minWidth: 220 }}
          type={isSecure ? 'password' : 'text'}
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={isSecure} onChange={(e) => setIsSecure(e.target.checked)} />
          Secure
        </label>
        <button className="btn-primary" disabled={busy || !name || !value} onClick={() => void save()}>
          Save variable
        </button>
      </div>

      {vars === null ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : vars.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No variables yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Value</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => (
              <tr key={v.name}>
                <td className="mono">{v.name}</td>
                <td>
                  {v.isSecure ? (
                    <span style={{ color: '#b23124', fontWeight: 700, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><LockIcon size={12} /> secure</span>
                  ) : (
                    <span style={{ fontSize: '0.8rem' }}>plain</span>
                  )}
                </td>
                <td className="mono" style={{ fontSize: '0.8rem', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.isSecure ? '••••••••' : v.value}
                </td>
                <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {new Date(v.updatedAt).toLocaleString()}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn-secondary"
                    style={{ marginRight: 6 }}
                    onClick={() => {
                      setName(v.name);
                      setIsSecure(v.isSecure);
                      setValue(v.isSecure ? '' : (v.value ?? ''));
                    }}
                  >
                    Edit
                  </button>
                  <button className="btn-danger" disabled={busy} onClick={() => void remove(v.name)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
