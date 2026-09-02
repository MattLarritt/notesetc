import { listAudit, listSpaces, listUsers } from '../../../lib/api';
import { AdminHelp } from '../admin-help';

export const dynamic = 'force-dynamic';

const ACTOR_TYPES = ['', 'human', 'ai_tool', 'api_token', 'system'];
const RESULTS = ['', 'success', 'denied', 'error'];

const resultStyle: Record<string, { bg: string; color: string }> = {
  success: { bg: '#e6f4ea', color: '#1e7d34' },
  denied: { bg: '#fdf2e6', color: '#b8730b' },
  error: { bg: '#fdeaea', color: '#c0392b' },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actorType?: string; result?: string }>;
}) {
  const { actorType = '', result = '' } = await searchParams;
  const [entries, users, spaces] = await Promise.all([
    listAudit({ actorType: actorType || undefined, result: result || undefined }),
    listUsers(),
    listSpaces(true),
  ]);

  const userEmail = new Map(users.map((u) => [u.id, u.email]));
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));

  const actorLabel = (e: (typeof entries)[number]): string => {
    const owner = e.actorUserId ? userEmail.get(e.actorUserId) ?? e.actorUserId : null;
    if (e.actorType === 'ai_tool') return `AI: ${e.aiAgentLabel ?? 'assistant'}${owner ? ` (via ${owner})` : ''}`;
    if (e.actorType === 'api_token') return `token${owner ? ` (${owner})` : ''}`;
    if (e.actorType === 'system') return 'system';
    return owner ?? 'human';
  };

  return (
    <div>
      <div className="page-actions">
        <h2 style={{ margin: 0 }}>Audit log</h2>
        <AdminHelp>
          <p>Append-only record of every permission-checked action, including denied ones —
          by humans, API tokens, automations and the AI assistant. Shows the most recent
          200 matching entries.</p>
        </AdminHelp>
      </div>
      <form method="get" className="card" style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Actor type</span>
          <select className="field" name="actorType" defaultValue={actorType}>
            {ACTOR_TYPES.map((t) => (
              <option key={t} value={t}>{t || 'Any'}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Result</span>
          <select className="field" name="result" defaultValue={result}>
            {RESULTS.map((r) => (
              <option key={r} value={r}>{r || 'Any'}</option>
            ))}
          </select>
        </label>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      {entries.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem' }}>No matching entries.</p>
      ) : (
        <table className="admin-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Result</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const rs = resultStyle[e.result] ?? { bg: 'var(--nav-bg)', color: 'var(--color-text)' };
              return (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.occurredAt).toLocaleString()}</td>
                  <td>{actorLabel(e)}</td>
                  <td className="mono">{e.action}</td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>
                    {e.targetType ?? '—'}
                    {e.spaceId && (
                      <span style={{ color: 'var(--color-text-muted)' }}> · {spaceName.get(e.spaceId) ?? 'space'}</span>
                    )}
                  </td>
                  <td>
                    <span
                      style={{
                        background: rs.bg,
                        color: rs.color,
                        padding: '0.1rem 0.5rem',
                        borderRadius: 999,
                        fontSize: '0.78rem',
                        fontWeight: 600,
                      }}
                    >
                      {e.result}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{e.ip ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
