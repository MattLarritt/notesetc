'use client';

import { useEffect, useRef, useState } from 'react';
import type { AutomationRun, AutomationRunLog } from '../../../../../lib/api';
import { RunBadge } from '../../run-badge';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

const TERMINAL = new Set(['success', 'error', 'timeout', 'killed', 'dead']);

/** Run detail: metadata + full structured log table; polls while the run is live. */
export function RunDetail({
  initialRun,
  initialLogs,
}: {
  initialRun: AutomationRun;
  initialLogs: AutomationRunLog[];
}) {
  const [run, setRun] = useState(initialRun);
  const [logs, setLogs] = useState(initialLogs);
  const afterSeqRef = useRef(initialLogs.length ? initialLogs[initialLogs.length - 1].seq : -1);

  useEffect(() => {
    if (TERMINAL.has(run.status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(
        `/api/bff/admin/automations/runs/${run.id}?afterSeq=${afterSeqRef.current}`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const body = (await res.json()) as { run: AutomationRun; logs: AutomationRunLog[] };
      setRun(body.run);
      if (body.logs.length) {
        afterSeqRef.current = body.logs[body.logs.length - 1].seq;
        setLogs((prev) => [...prev, ...body.logs]);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [run.id, run.status]);

  async function stop() {
    await fetch(`/api/bff/admin/automations/runs/${run.id}/stop`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': await csrf() },
    });
  }

  const running = !TERMINAL.has(run.status);
  const dur =
    run.startedAt && run.finishedAt
      ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
      : null;

  return (
    <div>
      <div className="card" style={{ padding: '0.8rem 1.1rem', display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <RunBadge status={run.status} />
        <span style={{ fontSize: '0.85rem' }}>
          Trigger: <b>{run.trigger}</b>
          {run.dryRun ? ' · mock mode' : ''}
          {run.debug ? ' · debug' : ''}
        </span>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          {new Date(run.createdAt).toLocaleString()}
          {dur ? ` · ${dur}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {running && (
          <button className="btn-danger" onClick={() => void stop()}>
            Force stop
          </button>
        )}
      </div>

      {run.error && (
        <div className="form-error" style={{ marginTop: 10 }}>
          {run.error}
        </div>
      )}

      {run.triggerPayload && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }}>Trigger payload</summary>
          <pre className="mono" style={{ background: '#f6f2e7', padding: '0.6rem', borderRadius: 6, fontSize: '0.75rem', overflowX: 'auto' }}>
            {JSON.stringify(run.triggerPayload, null, 2)}
          </pre>
        </details>
      )}

      <h3 style={{ marginTop: 18 }}>Logs {running && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>(live)</span>}</h3>
      {logs.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No log output{running ? ' yet' : ''}.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Time</th>
              <th style={{ width: 80 }}>Source</th>
              <th style={{ width: 80 }}>State</th>
              <th>Message</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.seq}>
                <td className="mono" style={{ fontSize: '0.75rem' }}>{new Date(l.ts).toLocaleTimeString()}</td>
                <td style={{ fontSize: '0.8rem' }}>{l.source}</td>
                <td>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color:
                        l.state === 'error' ? '#b23124' : l.state === 'warning' ? '#a9650d' : l.state === 'success' ? '#1e7d34' : 'var(--color-text-muted)',
                    }}
                  >
                    {l.state}
                  </span>
                </td>
                <td style={{ fontSize: '0.85rem' }}>{l.message}</td>
                <td className="mono" style={{ fontSize: '0.72rem', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.data !== null && l.data !== undefined ? JSON.stringify(l.data) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
