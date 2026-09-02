'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Client-side life for attachment embeds in rendered page HTML:
 *
 * - Clicks on `.nefm-attachment` chips/icons open a modal viewer instead of
 *   navigating (plain middle-click / ctrl-click still opens the serve URL).
 * - `.nefm-attachment-reader` marker divs are hydrated into inline viewers.
 *
 * Rendering per type: PDF via the browser's native viewer (iframe), txt as
 * text, csv/xlsx as tables (SheetJS for xlsx, dynamically imported), docx via
 * mammoth into a sandboxed iframe. Legacy .doc gets a download fallback.
 */

interface Meta {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

const ROW_CAP = 500;

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** Minimal CSV parser: quotes, escaped quotes, CRLF. Good enough for preview. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
      if (rows.length > ROW_CAP) return rows;
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function Table({ rows, truncated }: { rows: string[][]; truncated: boolean }) {
  if (!rows.length) return <p className="attachment-viewer-note">Empty file.</p>;
  const [head, ...body] = rows;
  return (
    <div className="attachment-viewer-scroll">
      <table>
        <thead>
          <tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <p className="attachment-viewer-note">Preview truncated to {ROW_CAP} rows — download for the full file.</p>
      )}
    </div>
  );
}

function Body({ meta }: { meta: Meta }) {
  const url = `/api/bff/attachments/${meta.id}`;
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'text'; text: string }
    | { kind: 'table'; rows: string[][]; truncated: boolean }
    | { kind: 'sheets'; sheets: { name: string; rows: string[][]; truncated: boolean }[] }
    | { kind: 'html'; html: string }
    | { kind: 'ready' }
  >({ kind: 'loading' });
  const [sheet, setSheet] = useState(0);

  const type = meta.contentType;
  const isPdf = type === 'application/pdf';
  const isImage = type.startsWith('image/');
  const isTxt = type === 'text/plain';
  const isCsv = type === 'text/csv';
  const isXlsx = type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const isDocx = type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        if (isPdf || isImage) { setState({ kind: 'ready' }); return; }
        if (isTxt || isCsv) {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) throw new Error(`fetch failed (${res.status})`);
          const text = await res.text();
          if (!alive) return;
          if (isTxt) setState({ kind: 'text', text });
          else {
            const rows = parseCsv(text);
            setState({ kind: 'table', rows: rows.slice(0, ROW_CAP + 1), truncated: rows.length > ROW_CAP });
          }
          return;
        }
        if (isXlsx) {
          const [{ read, utils }, res] = await Promise.all([
            import('xlsx'),
            fetch(url, { credentials: 'include' }),
          ]);
          if (!res.ok) throw new Error(`fetch failed (${res.status})`);
          const wb = read(await res.arrayBuffer());
          if (!alive) return;
          const sheets = wb.SheetNames.map((name) => {
            const all = utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' }) as string[][];
            return { name, rows: all.slice(0, ROW_CAP + 1), truncated: all.length > ROW_CAP };
          });
          setState({ kind: 'sheets', sheets });
          return;
        }
        if (isDocx) {
          const [mammoth, res] = await Promise.all([
            import('mammoth/mammoth.browser'),
            fetch(url, { credentials: 'include' }),
          ]);
          if (!res.ok) throw new Error(`fetch failed (${res.status})`);
          const { value } = await mammoth.convertToHtml({ arrayBuffer: await res.arrayBuffer() });
          if (!alive) return;
          setState({ kind: 'html', html: value });
          return;
        }
        setState({ kind: 'error', message: 'No inline preview for this file type.' });
      } catch {
        if (alive) setState({ kind: 'error', message: 'Could not load the preview.' });
      }
    }
    void load();
    return () => { alive = false; };
  }, [url, isPdf, isImage, isTxt, isCsv, isXlsx, isDocx]);

  if (isPdf) return <iframe className="attachment-viewer-frame" src={url} title={meta.filename} />;
  if (isImage) return <img className="attachment-viewer-image" src={url} alt={meta.filename} />;

  switch (state.kind) {
    case 'loading':
      return <p className="attachment-viewer-note">Loading preview…</p>;
    case 'text':
      return <pre className="attachment-viewer-text">{state.text}</pre>;
    case 'table':
      return <Table rows={state.rows} truncated={state.truncated} />;
    case 'sheets': {
      const current = state.sheets[Math.min(sheet, state.sheets.length - 1)];
      return (
        <div>
          {state.sheets.length > 1 && (
            <div className="attachment-viewer-tabs">
              {state.sheets.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  className="tb-btn"
                  data-active={i === sheet || undefined}
                  onClick={() => setSheet(i)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <Table rows={current.rows} truncated={current.truncated} />
        </div>
      );
    }
    case 'html':
      // mammoth output goes into a sandboxed frame: no scripts, no top-level nav.
      return (
        <iframe
          className="attachment-viewer-frame"
          sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;margin:1rem;line-height:1.5">${state.html}`}
          title={meta.filename}
        />
      );
    default:
      return (
        <div className="attachment-viewer-fallback">
          <p>{state.kind === 'error' ? state.message : 'No inline preview for this file type.'}</p>
          <a className="btn-primary" href={`${url}?download=1`}>Download {meta.filename}</a>
        </div>
      );
  }
}

function useMeta(id: string): { meta: Meta | null; error: string | null } {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/bff/attachments/${id}/meta`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const m = (await res.json()) as Meta;
        if (alive) setMeta(m);
      })
      .catch(() => { if (alive) setError('Attachment unavailable.'); });
    return () => { alive = false; };
  }, [id]);
  return { meta, error };
}

function ViewerModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { meta, error } = useMeta(id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal attachment-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>📎 {meta?.filename ?? name}</strong>
          <span className="attachment-viewer-meta">{meta ? fmtSize(meta.sizeBytes) : ''}</span>
          <span className="spacer" />
          <a className="tb-btn" href={`/api/bff/attachments/${id}?download=1`} title="Download">
            ⤓ Download
          </a>
          <button className="tb-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="attachment-viewer-body">
          {error ? <p className="attachment-viewer-note">{error}</p> : meta ? <Body meta={meta} /> : <p className="attachment-viewer-note">Loading…</p>}
        </div>
      </div>
    </div>
  );
}

function InlineReader({ id, name }: { id: string; name: string }) {
  const { meta, error } = useMeta(id);
  return (
    <div className="attachment-reader-inner">
      <div className="attachment-reader-head">
        <span>📄 {meta?.filename ?? name}</span>
        <span className="attachment-viewer-meta">{meta ? fmtSize(meta.sizeBytes) : ''}</span>
        <span className="spacer" />
        <a className="tb-btn" href={`/api/bff/attachments/${id}?download=1`} title="Download">⤓</a>
      </div>
      <div className="attachment-reader-body">
        {error ? <p className="attachment-viewer-note">{error}</p> : meta ? <Body meta={meta} /> : <p className="attachment-viewer-note">Loading…</p>}
      </div>
    </div>
  );
}

/**
 * Mount once under the rendered page HTML. Delegates chip clicks to the modal
 * viewer and portals inline readers into their server-rendered marker divs.
 */
export function AttachmentBits() {
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const [readers, setReaders] = useState<{ el: HTMLElement; id: string; name: string }[]>([]);

  useEffect(() => {
    const found: { el: HTMLElement; id: string; name: string }[] = [];
    document.querySelectorAll<HTMLElement>('.nefm-attachment-reader[data-attachment-id]').forEach((el) => {
      if (el.dataset.netcHydrated) return;
      el.dataset.netcHydrated = '1';
      el.textContent = ''; // drop the static placeholder label
      found.push({ el, id: el.dataset.attachmentId ?? '', name: el.dataset.attachmentName ?? 'file' });
    });
    setReaders(found);

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest?.('a.nefm-attachment') as HTMLAnchorElement | null;
      if (!a) return;
      const id = a.getAttribute('data-attachment-id');
      if (!id) return;
      e.preventDefault();
      setOpen({ id, name: a.getAttribute('data-attachment-name') || a.textContent || 'file' });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <>
      {readers.map((r) => createPortal(<InlineReader key={r.id} id={r.id} name={r.name} />, r.el))}
      {open && <ViewerModal id={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </>
  );
}
