'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, RefreshIcon, SparkIcon } from '../../components/ai-icons';

interface Settings {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  model: string;
  baseUrl: string;
  webSearch: boolean;
  hasApiKey: boolean;
}

interface ModelOption {
  id: string;
  note?: string;
}

const PROVIDERS: { id: Settings['provider']; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'ollama', label: 'Ollama' },
];

const MODEL_HINTS: Record<Settings['provider'], string> = {
  anthropic: 'e.g. claude-sonnet-5',
  openai: 'e.g. gpt-5-mini',
  gemini: 'e.g. gemini-3-flash',
  ollama: 'e.g. qwen3:14b',
};

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

/**
 * AI assistant setup, as a three-step card: provider, credentials, model.
 * The model list loads by itself the moment it can (stored key, pasted key
 * after a short debounce, or an Ollama address) — no explicit load step.
 */
export function AiSettingsForm() {
  const [s, setS] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const loadSeq = useRef(0);

  useEffect(() => {
    fetch('/api/bff/admin/ai/settings', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setS((await res.json()) as Settings);
      })
      .catch(() => setMsg({ ok: false, text: 'Could not load settings.' }));
  }, []);

  const provider = s?.provider;
  const baseUrl = s?.baseUrl ?? '';
  const hasApiKey = s?.hasApiKey ?? false;
  const loaded = s != null;

  // Auto-load the model list whenever listing becomes possible or its inputs
  // change; debounce while the admin is still typing a key / URL.
  useEffect(() => {
    if (!loaded) return;
    const canList = provider === 'ollama' ? !!baseUrl : !!(apiKey || hasApiKey);
    if (!canList) {
      setModels(null);
      return;
    }
    const seq = ++loadSeq.current;
    const debounce = apiKey || provider === 'ollama' ? 600 : 0;
    const t = setTimeout(() => {
      void (async () => {
        setLoadingModels(true);
        try {
          const token = await csrf();
          const res = await fetch('/api/bff/admin/ai/models', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json', 'x-csrf-token': token },
            body: JSON.stringify({
              provider,
              baseUrl: baseUrl || '',
              ...(apiKey ? { apiKey } : {}),
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { models?: ModelOption[]; error?: string };
          if (seq !== loadSeq.current) return; // superseded by a newer request
          if (data.error || !data.models?.length) {
            setModels(null);
            setCustomModel(true);
            if (data.error) setMsg({ ok: false, text: `Could not list models: ${data.error}` });
            return;
          }
          setMsg(null);
          setModels(data.models);
          setCustomModel(false);
          setS((prev) =>
            prev && !data.models!.some((m) => m.id === prev.model)
              ? { ...prev, model: data.models![0].id }
              : prev,
          );
        } finally {
          if (seq === loadSeq.current) setLoadingModels(false);
        }
      })();
    }, debounce);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, provider, apiKey, hasApiKey, reloadTick, provider === 'ollama' ? baseUrl : '']);

  if (!s) return <p>{msg?.text ?? 'Loading…'}</p>;

  const needsKey = s.provider !== 'ollama';
  const keyReady = needsKey ? !!apiKey || s.hasApiKey : !!s.baseUrl;

  async function save() {
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      const token = await csrf();
      const res = await fetch('/api/bff/admin/ai/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({
          enabled: s.enabled,
          provider: s.provider,
          model: s.model,
          baseUrl: s.baseUrl || '',
          webSearch: s.webSearch,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Settings & { message?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.message ?? `Save failed (${res.status}).` });
        return;
      }
      setS((prev) => (prev ? { ...prev, hasApiKey: data.hasApiKey } : prev));
      setApiKey('');
      setMsg({ ok: true, text: 'Saved.' });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const token = await csrf();
      // Tests exactly what is on screen — no save required. The stored key
      // fills in server-side when none has been typed.
      const res = await fetch('/api/bff/admin/ai/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({
          provider: s!.provider,
          model: s!.model,
          baseUrl: s!.baseUrl || '',
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        toolsOk?: boolean;
        error?: string;
      };
      if (!data.ok) setMsg({ ok: false, text: `Test failed: ${data.error ?? 'unknown error'}` });
      else if (!data.toolsOk)
        setMsg({
          ok: false,
          text: 'The model replied, but did not call tools — the assistant needs tool support. Pick a different model.',
        });
      else setMsg({ ok: true, text: 'Model replied and tool calling works.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-settings">
      <section className="ai-set-card">
        <div className="ai-set-step">
          <span className="ai-set-num">1</span>
          <div className="ai-set-body">
            <h3>Provider</h3>
            <div className="ai-seg" role="radiogroup" aria-label="Provider">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={s.provider === p.id}
                  className="ai-seg-btn"
                  data-active={s.provider === p.id || undefined}
                  onClick={() => {
                    setModels(null);
                    setCustomModel(false);
                    setMsg(null);
                    setS({ ...s, provider: p.id, model: '' });
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="ai-set-step">
          <span className="ai-set-num">2</span>
          <div className="ai-set-body">
            <h3>{needsKey ? 'API key' : 'Server address'}</h3>
            {needsKey ? (
              <>
                <div className="ai-key-row">
                  <input
                    type="password"
                    value={apiKey}
                    placeholder={s.hasApiKey ? 'A key is stored — paste to replace it' : 'Paste the provider API key'}
                    autoComplete="off"
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  {s.hasApiKey && !apiKey && (
                    <span className="ai-chip-ok">
                      <CheckIcon size={12} /> stored
                    </span>
                  )}
                </div>
                <p className="ai-set-hint">Stored encrypted, never shown again.</p>
                <details className="ai-set-advanced">
                  <summary>Advanced: custom endpoint</summary>
                  <input
                    type="text"
                    value={s.baseUrl}
                    placeholder="Leave blank for the provider default"
                    onChange={(e) => setS({ ...s, baseUrl: e.target.value })}
                  />
                </details>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={s.baseUrl}
                  placeholder="http://ollama.local:11434"
                  onChange={(e) => setS({ ...s, baseUrl: e.target.value })}
                />
                <p className="ai-set-hint">Only models that report tool support are listed.</p>
              </>
            )}
          </div>
        </div>

        <div className="ai-set-step">
          <span className="ai-set-num">3</span>
          <div className="ai-set-body">
            <h3>Model</h3>
            {!keyReady ? (
              <p className="ai-set-hint">Waiting for {needsKey ? 'an API key' : 'the server address'}…</p>
            ) : loadingModels ? (
              <p className="ai-set-hint">Loading models from {s.provider}…</p>
            ) : models && !customModel ? (
              <div className="ai-model-row">
                <select value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                      {m.note ? ` — ${m.note}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="ai-icon-btn"
                  title="Refresh the model list"
                  onClick={() => setReloadTick((t) => t + 1)}
                >
                  <RefreshIcon />
                </button>
              </div>
            ) : (
              <input
                type="text"
                value={s.model}
                placeholder={MODEL_HINTS[s.provider]}
                onChange={(e) => setS({ ...s, model: e.target.value })}
              />
            )}
            {models && (
              <button type="button" className="ai-link-btn" onClick={() => setCustomModel((v) => !v)}>
                {customModel ? 'Pick from the list instead' : 'Enter a model name manually'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="ai-set-options">
        <label className="ai-switch">
          <input
            type="checkbox"
            checked={s.webSearch}
            disabled={s.provider === 'ollama'}
            onChange={(e) => setS({ ...s, webSearch: e.target.checked })}
          />
          <span className="ai-switch-track" aria-hidden />
          <span className="ai-switch-label">
            Web search — the assistant may search the internet for public facts
            {s.provider === 'ollama' && ' (not available with Ollama)'}
          </span>
        </label>
      </section>

      <section className="ai-set-footer">
        <label className="ai-switch">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => setS({ ...s, enabled: e.target.checked })}
          />
          <span className="ai-switch-track" aria-hidden />
          <span className="ai-switch-label">
            <SparkIcon size={14} /> Enabled for all signed-in users
          </span>
        </label>
        <span className="spacer" />
        <button className="tb-btn" disabled={busy || !s.model} onClick={test} title="Tests the settings as shown — no save needed. Checks the model replies AND can call tools">
          {busy ? 'Working…' : 'Test'}
        </button>
        <button className="btn-primary" disabled={busy || !s.model} onClick={save}>
          Save
        </button>
      </section>

      {msg && <p className={`ai-set-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
    </div>
  );
}
