'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AdminToken } from '../../../lib/api';
import { InfoIcon, RefreshIcon } from '../../components/ai-icons';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

type SpaceLite = { id: string; name: string };
type UserLite = { id: string; email: string };

export function TokensManager({
  tokens,
  spaces,
  users,
}: {
  tokens: AdminToken[];
  spaces: SpaceLite[];
  users: UserLite[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [scoped, setScoped] = useState(false);
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null); // the one-time secret
  const [createdLabel, setCreatedLabel] = useState('new');
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
  const userEmail = new Map(users.map((u) => [u.id, u.email]));

  function toggleSpace(id: string) {
    setSpaceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function create() {
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    setCreated(null);
    try {
      const token = await csrf();
      const body: Record<string, unknown> = { name: name.trim() };
      if (scoped && spaceIds.length) body.allowedSpaceIds = spaceIds;
      const days = Number(expiresInDays);
      if (expiresInDays && Number.isFinite(days) && days > 0) body.expiresInDays = Math.floor(days);
      const res = await fetch('/api/bff/admin/tokens', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not create token.');
        return;
      }
      const j = (await res.json()) as { token: string };
      setCreatedLabel('new');
      setCreated(j.token);
      setName('');
      setScoped(false);
      setSpaceIds([]);
      setExpiresInDays('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function rotate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/admin/tokens/${id}/rotate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Could not rotate token.');
        return;
      }
      const j = (await res.json()) as { token: string };
      setCreatedLabel('rotated');
      setCreated(j.token);
      setCopied(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff/admin/tokens/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      if (res.ok || res.status === 204) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function statusOf(t: AdminToken): string {
    if (t.revokedAt) return 'revoked';
    if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()) return 'expired';
    return 'active';
  }

  const mcpUrl = origin ? `${origin}/api/v1/mcp` : '…';
  const restUrl = origin ? `${origin}/api/v1` : '…';
  const copyUrl = (u: string) => {
    void navigator.clipboard?.writeText(u);
    setCopiedUrl(u);
    setTimeout(() => setCopiedUrl(null), 1500);
  };

  return (
    <div className="tokens-page">
      {/* Connection details + collapsible help */}
      <div className="card tokens-connect">
        <div className="tokens-connect-row">
          <span className="tokens-connect-label">MCP server</span>
          <code className="mono">{mcpUrl}</code>
          <button className="tb-btn" disabled={!origin} onClick={() => copyUrl(mcpUrl)}>
            {copiedUrl === mcpUrl ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <div className="tokens-connect-row">
          <span className="tokens-connect-label">REST API</span>
          <code className="mono">{restUrl}</code>
          <button className="tb-btn" disabled={!origin} onClick={() => copyUrl(restUrl)}>
            {copiedUrl === restUrl ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <div className="tokens-connect-row">
          <span className="tokens-connect-label">Auth header</span>
          <code className="mono">Authorization: Bearer &lt;token&gt;</code>
          <button
            type="button"
            className="tb-btn tokens-help-btn"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          >
            <InfoIcon size={14} /> {helpOpen ? 'Hide help' : 'Help'}
          </button>
        </div>
        {helpOpen && (
          <div className="tokens-help">
            <p>
              Tokens let external tools and AI agents (Claude via MCP, scripts via REST) act as
              their owner. A token never exceeds its owner&apos;s permissions and can be
              restricted to specific spaces.
            </p>
            <p>
              The secret is shown <b>once</b> at creation — store it somewhere safe.{' '}
              <b>Rotate</b> issues a fresh secret for the same token: the old secret stops
              working immediately and the new one is shown once, so update the client right
              after rotating. <b>Revoke</b> kills the token permanently.
            </p>
          </div>
        )}
      </div>

      {/* One-time secret reveal */}
      {created && (
        <div className="card" style={{ borderColor: 'var(--color-primary)', background: '#fffae6' }}>
          <strong>
            Copy your {createdLabel} token now — it won’t be shown again.
            {createdLabel === 'rotated' && ' The old secret has stopped working.'}
          </strong>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
            <code className="mono" style={{ flex: 1, wordBreak: 'break-all', fontSize: '0.85rem' }}>
              {created}
            </code>
            <button
              className="btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(created);
                setCopied(true);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button className="tb-btn" onClick={() => { setCreated(null); setCopied(false); }} aria-label="Dismiss">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Create */}
      <div className="card" style={{ display: 'grid', gap: '0.7rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Token name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Reporting bot" />
        </label>

        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
          Restrict to specific spaces (otherwise the token has your full access)
        </label>
        {scoped && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', paddingLeft: '1.2rem' }}>
            {spaces.map((s) => (
              <label key={s.id} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={spaceIds.includes(s.id)} onChange={() => toggleSpace(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        )}

        <label style={{ display: 'grid', gap: '0.25rem', maxWidth: 220 }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Expires in (days, optional)</span>
          <input
            className="field"
            type="number"
            min={1}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="Never"
          />
        </label>

        <div>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
            Create token
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>

      {/* List */}
      {tokens.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem' }}>No tokens yet.</p>
      ) : (
        <table className="admin-table" style={{ marginTop: '1.25rem' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scope</th>
              <th>Owner</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const status = statusOf(t);
              return (
                <tr key={t.id} style={{ opacity: status === 'active' ? 1 : 0.55 }}>
                  <td>{t.name}</td>
                  <td className="mono">netck_{t.tokenPrefix}…</td>
                  <td>
                    {t.allowedSpaceIds
                      ? t.allowedSpaceIds.map((id) => spaceName.get(id) ?? '?').join(', ')
                      : 'All spaces'}
                  </td>
                  <td className="mono">{userEmail.get(t.ownerUserId) ?? t.ownerUserId}</td>
                  <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <span className={`badge ${status === 'active' ? 'published' : 'archived'}`}>{status}</span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {status === 'active' && (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        title="New secret, same token — old secret stops working immediately"
                        onClick={() => rotate(t.id)}
                        style={{ marginRight: '0.4rem' }}
                      >
                        <RefreshIcon size={13} /> Rotate
                      </button>
                    )}
                    {status !== 'revoked' && (
                      <button className="btn-secondary" disabled={busy} onClick={() => revoke(t.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
