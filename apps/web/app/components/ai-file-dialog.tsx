'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon, DocIcon, SparkIcon } from './ai-icons';

/**
 * "File a document" with the assistant. Four states: pick (drop zone +
 * description), confirm (upload done, token/cost estimate), thinking,
 * suggested (target page card; nothing is written until Attach is clicked).
 */

interface SpaceOpt { id: string; key: string; name: string }
interface Estimate { chars: number; tokens: number; estUsd: number | null; tooLarge: boolean }
interface Suggestion {
  pageId: string;
  pageTitle: string;
  summary: string | null;
  rationale: string;
  appendMarkdown: string;
  trace: { tool: string; summary: string }[];
}

const ACCEPT = '.pdf,.docx,.doc,.xlsx,.txt,.csv';

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = await csrf();
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status}).`);
  return data;
}

export function AiFileDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [spaces, setSpaces] = useState<SpaceOpt[]>([]);
  const [spaceId, setSpaceId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [includeContent, setIncludeContent] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'pick' | 'confirm' | 'thinking' | 'suggested' | 'done'>('pick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  useEffect(() => {
    fetch('/api/bff/spaces', { credentials: 'include' })
      .then(async (res) => (res.ok ? ((await res.json()) as { data: SpaceOpt[] }).data : []))
      .then((rows) => {
        setSpaces(rows);
        setSpaceId((cur) => cur || rows[0]?.id || '');
      })
      .catch(() => setError('Could not load spaces.'));
  }, []);

  async function uploadAndEstimate() {
    if (!file || !spaceId) return;
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/bff/spaces/${spaceId}/attachments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
        body: fd,
      });
      const up = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !up.id) {
        setError(up.message ?? `Upload failed (${res.status}).`);
        return;
      }
      setAttachmentId(up.id);
      if (includeContent) {
        try {
          setEstimate(await postJson<Estimate>('/api/bff/ai/estimate', { attachmentId: up.id }));
        } catch {
          // No extractable text (e.g. legacy .doc) — continue without content.
          setEstimate(null);
          setIncludeContent(false);
        }
      }
      setStep('confirm');
    } catch {
      setError('Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function askAi() {
    if (!attachmentId) return;
    setError(null);
    setBusy(true);
    setStep('thinking');
    try {
      const sug = await postJson<Suggestion>('/api/bff/ai/file-attachment', {
        attachmentId,
        prompt: prompt || undefined,
        includeContent: includeContent && !(estimate?.tooLarge ?? false),
      });
      setSuggestion(sug);
      setStep('suggested');
    } catch (err) {
      setError((err as Error).message);
      setStep('confirm');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!attachmentId || !suggestion) return;
    setError(null);
    setBusy(true);
    try {
      await postJson('/api/bff/ai/file-attachment/apply', {
        attachmentId,
        pageId: suggestion.pageId,
        appendMarkdown: suggestion.appendMarkdown,
      });
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const costLabel =
    estimate == null ? null
    : estimate.estUsd == null ? 'cost unknown for this model'
    : estimate.estUsd === 0 ? 'free — local model'
    : estimate.estUsd < 0.01 ? 'under 1¢'
    : `about $${estimate.estUsd.toFixed(2)}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ai-file-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>File a document</strong>
          <button className="tb-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {step === 'pick' && (
            <>
              <div
                className="ai-drop"
                data-over={dragOver || undefined}
                data-hasfile={!!file || undefined}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setFile(f);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT}
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="ai-drop-file">
                    <DocIcon size={22} />
                    <div>
                      <div className="ai-drop-name">{file.name}</div>
                      <div className="ai-drop-meta">{fmtSize(file.size)} — click to choose a different file</div>
                    </div>
                  </div>
                ) : (
                  <div className="ai-drop-empty">
                    <DocIcon size={26} />
                    <p>Drop a document here, or click to browse</p>
                    <span>PDF, Word, Excel, text or CSV — up to 25 MB</span>
                  </div>
                )}
              </div>

              <label className="ai-file-field">
                <span>Workspace</span>
                <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
                  {spaces.map((sp) => (
                    <option key={sp.id} value={sp.id}>{sp.name}</option>
                  ))}
                </select>
              </label>

              <label className="ai-file-field">
                <span>What is it?</span>
                <textarea
                  rows={2}
                  value={prompt}
                  placeholder="e.g. Manual for the new Bosch dishwasher in the kitchen"
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>

              <label className="ai-switch ai-file-switch">
                <input
                  type="checkbox"
                  checked={includeContent}
                  onChange={(e) => setIncludeContent(e.target.checked)}
                />
                <span className="ai-switch-track" aria-hidden />
                <span className="ai-switch-label">Let the assistant read the content — better filing and a summary</span>
              </label>

              <div className="ai-file-actions">
                <button className="btn-primary" disabled={busy || !file || !spaceId} onClick={uploadAndEstimate}>
                  {busy ? 'Uploading…' : 'Continue'}
                </button>
              </div>
            </>
          )}

          {step === 'confirm' && file && (
            <>
              <div className="ai-file-summary">
                <DocIcon size={20} />
                <div>
                  <div className="ai-drop-name">{file.name}</div>
                  <div className="ai-drop-meta">{fmtSize(file.size)} — uploaded</div>
                </div>
                <span className="ai-chip-ok"><CheckIcon size={12} /> stored</span>
              </div>

              {includeContent && estimate && (
                estimate.tooLarge ? (
                  <div className="ai-file-note warn">
                    The extracted text is very large ({estimate.tokens.toLocaleString()} tokens), so it
                    will not be sent — the assistant will file by name and description only.
                  </div>
                ) : (
                  <div className="ai-file-note">
                    The assistant will read about {estimate.tokens.toLocaleString()} tokens of content — {costLabel}.
                  </div>
                )
              )}
              {!includeContent && (
                <div className="ai-file-note">Filing by name and description only — content stays private.</div>
              )}

              <div className="ai-file-actions">
                <button className="tb-btn" disabled={busy} onClick={() => setStep('pick')}>Back</button>
                <span className="spacer" />
                <button className="btn-primary" disabled={busy} onClick={askAi}>Find the right page</button>
              </div>
            </>
          )}

          {step === 'thinking' && (
            <div className="ai-file-thinking">
              <SparkIcon size={26} />
              <p>Reading your notes<span className="ai-dots"><i /><i /><i /></span></p>
            </div>
          )}

          {step === 'suggested' && suggestion && (
            <>
              <div className="ai-suggest-card">
                <div className="ai-suggest-head">
                  <SparkIcon size={15} />
                  <span>Suggested page</span>
                </div>
                <div className="ai-suggest-title">{suggestion.pageTitle}</div>
                {suggestion.rationale && <p className="ai-suggest-why">{suggestion.rationale}</p>}
                {suggestion.summary && <blockquote className="ai-suggest-summary">{suggestion.summary}</blockquote>}
                {!!suggestion.trace.length && (
                  <div className="ai-trace">
                    <span className="ai-trace-lead">From your notes</span>
                    {suggestion.trace.slice(0, 6).map((t, i) => (
                      <span key={i} className="ai-trace-chip">{t.summary}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="ai-file-actions">
                <button className="tb-btn" disabled={busy} onClick={askAi}>Try again</button>
                <span className="spacer" />
                <button className="tb-btn" disabled={busy} onClick={onClose}>Cancel</button>
                <button className="btn-primary" disabled={busy} onClick={apply}>
                  {busy ? 'Attaching…' : 'Attach to this page'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && suggestion && (
            <div className="ai-file-done">
              <span className="ai-done-mark"><CheckIcon size={20} /></span>
              <p>Attached to <b>{suggestion.pageTitle}</b></p>
              <button
                className="btn-primary"
                onClick={() => { onClose(); router.push(`/pages/${suggestion.pageId}`); router.refresh(); }}
              >
                Open the page
              </button>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
