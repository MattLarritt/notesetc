'use client';

import { useRef, useState } from 'react';

export type AttachmentMode = 'link' | 'icon' | 'reader';

export interface AttachResult {
  id: string;
  filename: string;
  mode: AttachmentMode;
}

const ACCEPT = '.pdf,.docx,.doc,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

/**
 * Attach-a-document dialog: upload a file into the space, then insert it into
 * the page as a link chip, a bare icon, or an embedded reader.
 */
export function AttachDialog({
  spaceId,
  pageId,
  onInsert,
  onClose,
}: {
  spaceId?: string;
  pageId?: string;
  onInsert: (result: AttachResult) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AttachmentMode>('link');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!spaceId) {
      setError('Could not determine the space to upload into.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const fd = new FormData();
      fd.append('file', file);
      const q = pageId ? `?pageId=${encodeURIComponent(pageId)}` : '';
      const res = await fetch(`/api/bff/spaces/${spaceId}/attachments${q}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
        body: fd,
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? `Upload failed (${res.status}).`);
        return;
      }
      const { id, filename } = (await res.json()) as { id: string; filename: string };
      onInsert({ id, filename: filename || file.name, mode });
    } catch {
      setError('Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Attach a document</strong>
          <button className="tb-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          <p style={{ margin: '0 0 0.75rem', color: 'var(--color-text-muted)' }}>
            PDF, Word (docx/doc), Excel (xlsx), text or CSV — stored in this space&apos;s
            attachment folder.
          </p>

          <fieldset className="attach-mode">
            <legend>Insert as</legend>
            <label>
              <input type="radio" name="attach-mode" checked={mode === 'link'} onChange={() => setMode('link')} />
              Link — filename chip; opens the viewer
            </label>
            <label>
              <input type="radio" name="attach-mode" checked={mode === 'icon'} onChange={() => setMode('icon')} />
              Icon — compact 📎; opens the viewer
            </label>
            <label>
              <input type="radio" name="attach-mode" checked={mode === 'reader'} onChange={() => setMode('reader')} />
              Embedded reader — document rendered in the page
            </label>
          </fieldset>

          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />

          {busy && <p style={{ color: 'var(--color-text-muted)' }}>Uploading…</p>}
          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
