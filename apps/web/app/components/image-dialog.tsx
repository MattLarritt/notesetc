'use client';

import { useRef, useState } from 'react';

export interface ImageResult {
  src: string;
  alt?: string;
}

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

/**
 * Insert-image dialog with two modes: upload a file (stored as an Attachment and
 * served from /api/bff/attachments/:id) or embed an existing image URL.
 */
export function ImageDialog({
  spaceId,
  pageId,
  onInsert,
  onClose,
}: {
  spaceId?: string;
  pageId?: string;
  onInsert: (result: ImageResult) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [url, setUrl] = useState('https://');
  const [alt, setAlt] = useState('');
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
      const { id } = (await res.json()) as { id: string };
      onInsert({ src: `/api/bff/attachments/${id}`, alt: alt || file.name });
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
          <strong>Insert image</strong>
          <button className="tb-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button className="tab" data-active={tab === 'upload' || undefined} onClick={() => setTab('upload')}>
            Upload
          </button>
          <button className="tab" data-active={tab === 'url' || undefined} onClick={() => setTab('url')}>
            From URL
          </button>
        </div>

        <div className="modal-body">
          <label style={{ display: 'grid', gap: '0.25rem', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Alt text (description)</span>
            <input
              className="field"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Describe the image for accessibility"
            />
          </label>

          {tab === 'upload' ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <div
                className="upload-zone"
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void upload(f);
                }}
              >
                {busy ? 'Uploading…' : 'Click or drop an image here'}
                <span className="upload-hint">PNG, JPEG, GIF or WebP · up to 10 MB</span>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) onInsert({ src: url.trim(), alt });
              }}
            >
              <input
                className="field"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/image.png"
              />
              <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
                <button type="submit" className="btn-primary" disabled={!url.trim()}>
                  Insert image
                </button>
              </div>
            </form>
          )}

          {error && <div className="form-error" style={{ marginTop: '0.6rem' }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
