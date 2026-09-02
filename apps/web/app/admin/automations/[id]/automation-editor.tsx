'use client';

import { LockIcon } from '../../../components/ai-icons';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Automation } from '../../../../lib/api';
import { CodeEditor, type CodeEditorApi } from '../code-editor';
import { ScheduleBuilder } from '../schedule-builder';
import { VariablesManager } from '../variables-manager';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

const DEFAULT_SCRIPT = `// Automation script — plain JavaScript with top-level await.
// netc.trigger tells you why this ran; netc.log(...) writes to the run log.
netc.log({ state: 'info', message: 'Triggered by ' + netc.trigger.type });

// Examples:
// const page = await netc.pages.get(netc.trigger.pageId);
// const token = await netc.variable('apiToken');   // script-scoped first, then global
// await netc.pages.update(page.page.id, { content: '# Updated' });
`;

const EVENT_OPTIONS = [
  { value: 'page.created', label: 'On Create' },
  { value: 'page.updated', label: 'On Edit' },
  { value: 'page.moved', label: 'On Move' },
  { value: 'page.deleted', label: 'On Delete' },
];

interface PickerVar {
  name: string;
  isSecure: boolean;
  scope: 'script' | 'global';
}

export function AutomationEditor({ automation }: { automation: Automation | null }) {
  const router = useRouter();
  const isNew = automation === null;
  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const [triggerType, setTriggerType] = useState(automation?.triggerType ?? 'page_event');
  const [events, setEvents] = useState<string[]>(
    (automation?.triggerConfig?.events as string[] | undefined) ?? ['page.created'],
  );
  const [cron, setCron] = useState((automation?.triggerConfig?.cron as string | undefined) ?? '0 9 * * *');
  const [timezone, setTimezone] = useState((automation?.triggerConfig?.timezone as string | undefined) ?? '');
  const [webhookSlug, setWebhookSlug] = useState(automation?.webhookSlug ?? '');
  const [timeoutSec, setTimeoutSec] = useState(String((automation?.timeoutMs ?? 60000) / 1000));
  const [debugMode, setDebugMode] = useState(automation?.debugMode ?? false);
  const [script, setScript] = useState(automation?.script || DEFAULT_SCRIPT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretOnce, setSecretOnce] = useState<string | null>(null);
  const [pickerVars, setPickerVars] = useState<PickerVar[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const editorApi = useRef<CodeEditorApi | null>(null);

  // ---- dirty tracking (drives the save indicator + Ctrl+S) ----
  const snapshot = useCallback(
    () => JSON.stringify({ name, description, events, cron, timezone, webhookSlug, timeoutSec, debugMode, script }),
    [name, description, events, cron, timezone, webhookSlug, timeoutSec, debugMode, script],
  );
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    isNew ? '' : JSON.stringify({
      name: automation.name,
      description: automation.description ?? '',
      events: (automation.triggerConfig?.events as string[] | undefined) ?? ['page.created'],
      cron: (automation.triggerConfig?.cron as string | undefined) ?? '0 9 * * *',
      timezone: (automation.triggerConfig?.timezone as string | undefined) ?? '',
      webhookSlug: automation.webhookSlug ?? '',
      timeoutSec: String(automation.timeoutMs / 1000),
      debugMode: automation.debugMode,
      script: automation.script || DEFAULT_SCRIPT,
    }),
  );
  const dirty = isNew || snapshot() !== savedSnapshot;

  // ---- variables for the picker + secure highlighting ----
  const loadVars = useCallback(async () => {
    const requests: Array<Promise<PickerVar[]>> = [
      fetch('/api/bff/admin/automations/variables', { credentials: 'include' })
        .then(async (r) => (r.ok ? ((await r.json()) as { data: Array<{ name: string; isSecure: boolean }> }).data : []))
        .then((d) => d.map((v) => ({ name: v.name, isSecure: v.isSecure, scope: 'global' as const }))),
    ];
    if (automation) {
      requests.push(
        fetch(`/api/bff/admin/automations/${automation.id}/variables`, { credentials: 'include' })
          .then(async (r) => (r.ok ? ((await r.json()) as { data: Array<{ name: string; isSecure: boolean }> }).data : []))
          .then((d) => d.map((v) => ({ name: v.name, isSecure: v.isSecure, scope: 'script' as const }))),
      );
    }
    const [globals, scoped = []] = await Promise.all(requests);
    // Scoped first (they shadow globals of the same name).
    const seen = new Set(scoped.map((v) => v.name));
    setPickerVars([...scoped, ...globals.filter((v) => !seen.has(v.name))]);
  }, [automation]);

  useEffect(() => {
    void loadVars();
  }, [loadVars]);

  const secureNames = useMemo(() => pickerVars.filter((v) => v.isSecure).map((v) => v.name), [pickerVars]);

  function toggleEvent(v: string) {
    setEvents((prev) => (prev.includes(v) ? prev.filter((e) => e !== v) : [...prev, v]));
  }

  const save = useCallback(async () => {
    setError(null);
    if (!name.trim()) {
      setError('A name is required.');
      return;
    }
    const timeoutMs = Math.round(Number(timeoutSec) * 1000);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
      setError('Timeout must be between 1 and 600 seconds.');
      return;
    }
    const triggerConfig =
      triggerType === 'page_event'
        ? { events }
        : triggerType === 'schedule'
          ? { cron, ...(timezone ? { timezone } : {}) }
          : {};
    if (triggerType === 'page_event' && events.length === 0) {
      setError('Pick at least one page event.');
      return;
    }
    setBusy(true);
    try {
      const token = await csrf();
      if (isNew) {
        const res = await fetch('/api/bff/admin/automations', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({
            name,
            description: description || undefined,
            triggerType,
            triggerConfig,
            script,
            timeoutMs,
            debugMode,
            enabled: false,
            ...(triggerType === 'webhook' && webhookSlug ? { webhookSlug } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          automation?: { id: string };
          webhookSecret?: string;
          message?: string;
        };
        if (!res.ok || !body.automation) {
          setError(body.message ?? 'Create failed.');
          return;
        }
        if (body.webhookSecret) {
          setSecretOnce(body.webhookSecret);
          sessionStorage.setItem('automation-nav', `/admin/automations/${body.automation.id}`);
          return;
        }
        router.push(`/admin/automations/${body.automation.id}`);
        router.refresh();
      } else {
        const res = await fetch(`/api/bff/admin/automations/${automation.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({
            name,
            description: description || null,
            triggerConfig,
            script,
            timeoutMs,
            debugMode,
            ...(triggerType === 'webhook' && webhookSlug ? { webhookSlug } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? 'Save failed.');
          return;
        }
        setSavedSnapshot(snapshot());
        setSavedAt(new Date());
        router.refresh(); // refresh server-rendered bits (page heading) without nav
      }
    } finally {
      setBusy(false);
    }
  }, [automation, cron, debugMode, description, events, isNew, name, router, script, snapshot, timeoutSec, timezone, triggerType, webhookSlug]);

  // Ctrl+S / Cmd+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!busy) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, save]);

  async function rotateSecret() {
    if (!automation) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bff/admin/automations/${automation.id}/rotate-secret`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': await csrf() },
      });
      const body = (await res.json().catch(() => ({}))) as { webhookSecret?: string; message?: string };
      if (!res.ok || !body.webhookSecret) {
        setError(body.message ?? 'Rotation failed.');
        return;
      }
      setSecretOnce(body.webhookSecret);
    } finally {
      setBusy(false);
    }
  }

  function dismissSecret() {
    setSecretOnce(null);
    const nav = sessionStorage.getItem('automation-nav');
    if (nav) {
      sessionStorage.removeItem('automation-nav');
      router.push(nav);
      router.refresh();
    }
  }

  function insertVariable(v: PickerVar) {
    editorApi.current?.insert(`await netc.variable('${v.name}')`);
    setPickerOpen(false);
  }

  const row: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' };

  const saveState = busy ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Saved ✓ ${savedAt.toLocaleTimeString()}` : 'Saved ✓';

  return (
    <>
      <div className="card" style={{ display: 'grid', gap: 14, padding: '1rem 1.2rem' }}>
        {error && <div className="form-error">{error}</div>}

        <div style={row}>
          <input
            className="field"
            style={{ flex: 2, minWidth: 220 }}
            placeholder="Automation name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="field"
            style={{ flex: 3, minWidth: 260 }}
            placeholder="Description (optional)"
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div style={row}>
          <label style={{ fontWeight: 600 }}>Trigger</label>
          <select
            className="field"
            value={triggerType}
            disabled={!isNew}
            title={isNew ? undefined : 'Trigger type is fixed after creation'}
            onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}
          >
            <option value="page_event">Page event</option>
            <option value="schedule">Schedule</option>
            <option value="webhook">Webhook</option>
          </select>

          {triggerType === 'page_event' && (
            <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {EVENT_OPTIONS.map((o) => (
                <label key={o.value} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.88rem' }}>
                  <input type="checkbox" checked={events.includes(o.value)} onChange={() => toggleEvent(o.value)} />
                  {o.label}
                </label>
              ))}
            </span>
          )}

          {triggerType === 'webhook' && (
            <>
              <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                POST /api/v1/hooks/
              </span>
              <input
                className="field mono"
                style={{ width: 200 }}
                placeholder="slug (from name if empty)"
                value={webhookSlug ?? ''}
                onChange={(e) => setWebhookSlug(e.target.value)}
              />
              {!isNew && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void rotateSecret()}>
                  Rotate secret
                </button>
              )}
            </>
          )}
        </div>

        {triggerType === 'schedule' && (
          <ScheduleBuilder
            initialCron={cron}
            timezone={timezone}
            onCronChange={setCron}
            onTimezoneChange={setTimezone}
          />
        )}

        <div style={row}>
          <label style={{ fontWeight: 600 }}>Timeout</label>
          <input
            className="field mono"
            style={{ width: 90 }}
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
          />
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>seconds</span>
          <label style={{ display: 'flex', gap: 5, alignItems: 'center', marginLeft: 16 }}>
            <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
            Debug mode
          </label>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            (stores console.* output in run logs)
          </span>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <label style={{ fontWeight: 600 }}>Script</label>
            <span style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.2rem 0.6rem' }}
                onClick={() => setPickerOpen((o) => !o)}
                disabled={pickerVars.length === 0}
                title={pickerVars.length === 0 ? 'No variables defined yet' : 'Insert a variable reference at the cursor'}
              >
                {'{x}'} Insert variable ▾
              </button>
              {pickerOpen && (
                <span
                  style={{
                    position: 'absolute', top: '110%', left: 0, zIndex: 30, minWidth: 260,
                    background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8,
                    boxShadow: '0 6px 18px rgba(0,0,0,0.12)', padding: '0.3rem', display: 'block',
                  }}
                >
                  {pickerVars.map((v) => (
                    <button
                      key={`${v.scope}:${v.name}`}
                      type="button"
                      onClick={() => insertVariable(v)}
                      style={{
                        display: 'flex', width: '100%', gap: 8, alignItems: 'center',
                        padding: '0.35rem 0.6rem', border: 'none', background: 'none',
                        cursor: 'pointer', borderRadius: 6, textAlign: 'left', fontSize: '0.85rem',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f6f2e7')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <span className="mono" style={{ color: v.isSecure ? '#b23124' : undefined, fontWeight: v.isSecure ? 700 : 400 }}>
                        {v.isSecure && <LockIcon size={11} />} {v.name}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                        {v.scope === 'script' ? 'this script' : 'global'}
                      </span>
                    </button>
                  ))}
                </span>
              )}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '0.8rem', color: dirty ? '#a9650d' : '#1e7d34', fontWeight: 600 }}>
              {saveState}
            </span>
          </div>
          <CodeEditor initialValue={script} onChange={setScript} secureNames={secureNames} apiRef={editorApi} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Ctrl+S saves</span>
          <button className="btn-primary" disabled={busy || (!isNew && !dirty)} onClick={() => void save()}>
            {busy ? 'Saving…' : isNew ? 'Create automation' : 'Save changes'}
          </button>
        </div>

        {secretOnce && (
          <div className="modal-backdrop">
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">Webhook secret — shown once</div>
              <div className="modal-body">
                <p>
                  Send this in the <code>X-Hook-Secret</code> header. It cannot be retrieved again —
                  only rotated.
                </p>
                <pre className="mono" style={{ padding: '0.6rem', background: '#f6f2e7', borderRadius: 6, overflowX: 'auto' }}>
                  {secretOnce}
                </pre>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn-primary" onClick={dismissSecret}>
                    I’ve stored it
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {!isNew && <VariablesManager automationId={automation.id} onChanged={() => void loadVars()} />}
    </>
  );
}
