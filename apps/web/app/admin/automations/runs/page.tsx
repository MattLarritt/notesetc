import Link from 'next/link';
import { listAutomationRuns, listAutomations } from '../../../../lib/api';
import { RunBadge } from '../run-badge';

export const dynamic = 'force-dynamic';

export default async function AutomationRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ automationId?: string; status?: string }>;
}) {
  const params = await searchParams;
  const [runs, automations] = await Promise.all([
    listAutomationRuns({ automationId: params.automationId, status: params.status }),
    listAutomations(),
  ]);
  const names = Object.fromEntries(automations.map((a) => [a.id, a.name]));

  return (
    <div>
      <div className="page-actions">
        <h2 style={{ marginTop: 0 }}>Automation runs</h2>
        <span style={{ flex: 1 }} />
        <Link className="btn-secondary" href="/admin/automations">
          ← Automations
        </Link>
      </div>

      <form method="get" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select className="field" name="automationId" defaultValue={params.automationId ?? ''}>
          <option value="">All automations</option>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select className="field" name="status" defaultValue={params.status ?? ''}>
          <option value="">Any status</option>
          {['queued', 'running', 'success', 'error', 'timeout', 'killed', 'dead'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn-secondary" type="submit">
          Filter
        </button>
      </form>

      {runs.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No runs match.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Automation</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const dur =
                r.startedAt && r.finishedAt
                  ? `${((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000).toFixed(1)}s`
                  : '—';
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/automations/runs/${r.id}`}>
                      {new Date(r.createdAt).toLocaleString()}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/admin/automations/${r.automationId}`}>
                      {names[r.automationId] ?? r.automationId.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{r.trigger}</td>
                  <td>
                    <RunBadge status={r.status} />
                  </td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>{dur}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {r.dryRun ? 'mock' : 'live'}
                    {r.debug ? ' · debug' : ''}
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
