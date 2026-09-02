'use client';

import { useEffect, useRef, useState } from 'react';
import type { AutomationRun, AutomationRunLog } from '../../../../lib/api';
import { RunBadge } from '../run-badge';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

const TERMINAL = new Set(['success', 'error', 'timeout', 'killed', 'dead']);

const STATE_COLOR: Record<string, string> = {
  success: '#1e7d34',
  warning: '#a9650d',
  error: '#b23124',
  info: '#5a6072',
};

/**
 * Test console: runs the automation on demand (Mock Mode by default) and
 * live-streams its log output by polling ?afterSeq until the run finishes.
 */
export function TestPanel({ automationId }: { automationId: string }) {
  const [mockMode, setMockMode] = useState(true);
  const [simulatedEvent, setSimulatedEvent] = useState('');
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [logs, setLogs] = useState<AutomationRunLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const afterSeqRef = useRef(-1);
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => stopPolling(), []);
  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [logs]);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function startPolling(runId: string) {
    stopPolling();
    afterSeqRef.current = -1;
    pollRef.current = setInterval(async () => {
      const res = await fetch(
        `/api/bff/admin/automations/runs/${runId}?afterSeq=${afterSeqRef.current}`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const body = (await res.json()) as { run: AutomationRun; logs: AutomationRunLog[] };
      setRun(body.run);
      if (body.logs.length) {
        afterSeqRef.current = body.logs[body.logs.length - 1].seq;
        setLogs((prev) => [...prev, ...body.logs]);
      }
      if (TERMINAL.has(body.run.status)) stopPolling();
    }, 900);
  }

  async function runTest() {
    setError(null);
    let simulated: Record<string, unknown> | undefined;
    if (simulatedEvent.trim()) {
      try {
        simulated = JSON.parse(simulatedEvent) as Record<string, unknown>;
      } catch {
        setError('Simulated event is not valid JSON.');
        return;
      }
    }
    setBusy(true);
    setLogs([]);
    setRun(null);
    try {
      const res = await fetch(`/api/bff/admin/automations/${automationId}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify({ mockMode, ...(simulated ? { simulatedEvent: simulated } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; message?: string };
      if (!res.ok || !body.runId) {
        setError(body.message ?? 'Test failed to start.');
        return;
      }
      setRun({ id: body.runId, status: 'queued' } as AutomationRun);
      startPolling(body.runId);
    } finally {
      setBusy(false);
    }
  }

  async function stopRun() {
    if (!run) return;
    await fetch(`/api/bff/admin/automations/runs/${run.id}/stop`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': await csrf() },
    });
  }

  const running = run !== null && !TERMINAL.has(run.status);

  return (
    <div className="card" style={{ marginTop: 16, padding: '1rem 1.2rem' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Test console</h3>
        <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={mockMode} onChange={(e) => setMockMode(e.target.checked)} />
          Mock Mode
        </label>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.83rem' }}>
          {mockMode
            ? 'reads are real; writes are logged, not applied'
            : 'LIVE — writes will really happen'}
        </span>
        <span style={{ flex: 1 }} />
        {run && <RunBadge status={run.status} />}
        {running && (
          <button className="btn-danger" onClick={() => void stopRun()}>
            Force stop
          </button>
        )}
        <button className="btn-primary" disabled={busy || running} onClick={() => void runTest()}>
          {running ? 'Running…' : 'Run test'}
        </button>
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.86rem' }}>
          Simulated trigger event (optional JSON — merged into netc.trigger)
        </summary>
        <textarea
          className="field mono"
          style={{ width: '100%', minHeight: 70, marginTop: 6, fontSize: '0.8rem' }}
          placeholder={'{ "type": "page.created", "pageId": "…", "spaceId": "…" }'}
          value={simulatedEvent}
          onChange={(e) => setSimulatedEvent(e.target.value)}
        />
      </details>

      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

      <div
        ref={consoleRef}
        className="mono"
        style={{
          marginTop: 10,
          background: '#2c2f3d',
          color: '#e8e6f0',
          borderRadius: 8,
          padding: '0.7rem 0.9rem',
          minHeight: 120,
          maxHeight: 320,
          overflowY: 'auto',
          fontSize: '0.78rem',
          lineHeight: 1.55,
        }}
      >
        {logs.length === 0 && (
          <span style={{ opacity: 0.5 }}>{run ? 'Waiting for output…' : 'Run a test to see output here.'}</span>
        )}
        {logs.map((l) => (
          <div key={l.seq}>
            <span style={{ opacity: 0.45 }}>{new Date(l.ts).toLocaleTimeString()} </span>
            <span style={{ color: STATE_COLOR[l.state] ? '#ffd75e' : undefined, opacity: 0.8 }}>
              [{l.source}{l.state && l.state !== 'info' ? `:${l.state}` : ''}]
            </span>{' '}
            {l.message}
            {l.data !== null && l.data !== undefined && (
              <span style={{ opacity: 0.65 }}> {JSON.stringify(l.data)}</span>
            )}
          </div>
        ))}
        {run?.error && TERMINAL.has(run.status) && run.status !== 'success' && (
          <div style={{ color: '#ff9d94', marginTop: 4 }}>Error: {run.error}</div>
        )}
      </div>
    </div>
  );
}
