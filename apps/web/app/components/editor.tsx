'use client';

import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Callout, type CalloutKind } from './callout-extension';
import { Section } from './section-extension';
import { Subpages } from './subpages-extension';
import { ApiRegion } from './api-region-extension';
import { TrailingNode } from './trailing-node-extension';
import { LinkDialog, type LinkResult } from './link-dialog';
import { ImageDialog, type ImageResult } from './image-dialog';
import { Attachment, AttachmentReader } from './attachment-extension';
import { AttachDialog, type AttachResult } from './attach-dialog';
import { IconPicker } from './icon-picker';
import { refreshNav } from '../../lib/nav-refresh';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

export interface EditorProps {
  mode: 'create' | 'edit' | 'space-overview' | 'propose' | 'template';
  spaceId?: string;
  parentId?: string;
  pageId?: string;
  templateId?: string;
  baseVersionNumber?: number;
  initialTitle?: string;
  initialMarkdown?: string;
  initialIcon?: string | null;
  /** Heading shown in the top bar for space-overview mode (the space name). */
  heading?: string;
  cancelHref: string;
  /** Optional right-hand "Page settings" console (edit mode). */
  sidebar?: React.ReactNode;
}

export function PageEditor(props: EditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle ?? '');
  const [icon, setIcon] = useState<string | null>(props.initialIcon ?? null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    immediatelyRender: false, // required for SSR (Next.js)
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: false }),
      Callout,
      Section,
      Subpages,
      ApiRegion,
      Attachment,
      AttachmentReader,
      TrailingNode,
      Markdown.configure({ html: false, tightLists: true, transformPastedText: true }),
    ],
    content: props.initialMarkdown ?? '',
  });

  function cmd(fn: (chain: ReturnType<NonNullable<typeof editor>['chain']>) => void) {
    if (!editor) return;
    fn(editor.chain().focus());
  }

  function insertImage({ src, alt }: ImageResult) {
    editor?.chain().focus().setImage({ src, alt: alt || undefined }).run();
    setImageOpen(false);
  }

  function insertAttachment({ id, filename, mode }: AttachResult) {
    if (!editor) return;
    if (mode === 'reader') {
      editor.chain().focus().insertContent({ type: 'attachmentReader', attrs: { id, name: filename } }).run();
    } else {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'attachment', attrs: { id, name: filename, icon: mode === 'icon' } })
        .run();
    }
    setAttachOpen(false);
  }

  function insertLink({ href, text }: LinkResult) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      // Nothing selected — insert linked text.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setLinkOpen(false);
  }

  async function save() {
    if (!editor) return;
    setError(null);
    if (props.mode !== 'space-overview' && !title.trim()) {
      setError(props.mode === 'template' ? 'A template name is required.' : 'A title is required.');
      return;
    }
    setBusy(true);
    try {
      const content = editor.storage.markdown.getMarkdown();
      const token = await csrf();

      let res: Response;
      if (props.mode === 'template') {
        res = await fetch(`/api/bff/templates/${props.templateId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({ name: title, content }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? 'Save failed.');
          return;
        }
        router.push(props.cancelHref);
        router.refresh();
        return;
      }
      if (props.mode === 'propose') {
        res = await fetch(`/api/bff/pages/${props.pageId}/proposals`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({
            proposedContent: content,
            proposedTitle: title || undefined,
            rationale: summary || undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? 'Could not submit proposal.');
          return;
        }
        router.push(`/pages/${props.pageId}`);
        router.refresh();
        return;
      }
      if (props.mode === 'space-overview') {
        res = await fetch(`/api/bff/spaces/${props.spaceId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({ overview: content }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? 'Save failed.');
          return;
        }
        refreshNav();
        router.push(`/spaces/${props.spaceId}`);
        router.refresh();
        return;
      }
      if (props.mode === 'create') {
        res = await fetch(`/api/bff/spaces/${props.spaceId}/pages`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({
            title,
            content,
            icon: icon || undefined,
            ...(props.parentId ? { parentId: props.parentId } : {}),
            changeSummary: summary || undefined,
          }),
        });
      } else {
        res = await fetch(`/api/bff/pages/${props.pageId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify({
            title,
            content,
            icon,
            baseVersionNumber: props.baseVersionNumber,
            changeSummary: summary || undefined,
          }),
        });
      }

      if (res.status === 409) {
        setError('This page changed since you opened it. Reload to get the latest version.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Save failed.');
        return;
      }
      const detail = (await res.json()) as { page?: { id: string } };
      const targetId = detail.page?.id ?? props.pageId;
      refreshNav();
      router.push(`/pages/${targetId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const tb = (label: string, onClick: () => void, active = false, title?: string) => (
    <button type="button" className="tb-btn" title={title} data-active={active || undefined} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="editor-shell">
      <div className="editor-head">
      <div className="editor-topbar">
        <a className="btn-secondary" href={props.cancelHref}>
          ← Cancel
        </a>
        {props.mode === 'space-overview' ? (
          <span className="editor-title" style={{ fontWeight: 650 }}>
            {props.heading ? `${props.heading} — overview` : 'Space overview'}
          </span>
        ) : props.mode === 'template' ? (
          <input
            className="field editor-title"
            placeholder="Template name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        ) : (
          <>
            {props.mode !== 'propose' && <IconPicker value={icon} onChange={setIcon} />}
            <input
              className="field editor-title"
              placeholder="Page title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="field editor-summary"
              placeholder={props.mode === 'propose' ? 'Rationale (why this change?)' : 'Change summary (optional)'}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </>
        )}
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy
            ? 'Saving…'
            : props.mode === 'create'
              ? 'Create'
              : props.mode === 'propose'
                ? 'Propose'
                : 'Save'}
        </button>
      </div>

      {error && <div className="editor-error form-error">{error}</div>}

      {editor && (
        <div className="editor-toolbar">
          {tb('B', () => cmd((c) => c.toggleBold().run()), editor.isActive('bold'), 'Bold')}
          {tb('I', () => cmd((c) => c.toggleItalic().run()), editor.isActive('italic'), 'Italic')}
          {tb('H1', () => cmd((c) => c.toggleHeading({ level: 1 }).run()), editor.isActive('heading', { level: 1 }))}
          {tb('H2', () => cmd((c) => c.toggleHeading({ level: 2 }).run()), editor.isActive('heading', { level: 2 }))}
          {tb('H3', () => cmd((c) => c.toggleHeading({ level: 3 }).run()), editor.isActive('heading', { level: 3 }))}
          {tb('• List', () => cmd((c) => c.toggleBulletList().run()), editor.isActive('bulletList'))}
          {tb('1. List', () => cmd((c) => c.toggleOrderedList().run()), editor.isActive('orderedList'))}
          {tb('“ Quote', () => cmd((c) => c.toggleBlockquote().run()), editor.isActive('blockquote'))}
          {tb('</> Code', () => cmd((c) => c.toggleCodeBlock().run()), editor.isActive('codeBlock'))}
          {tb('◇ Diagram', () => cmd((c) => c.insertContent(
            '\n```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do a thing]\n  B -->|No| D[Do another]\n```\n',
          ).run()), false, 'Insert a Mermaid diagram')}
          {tb('Table', () => cmd((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()))}
          {tb('🖼 Image', () => setImageOpen(true), false, 'Insert image')}
          {tb('📎 Attach', () => setAttachOpen(true), false, 'Attach a document (PDF, Word, Excel, text, CSV)')}
          {tb('🔗 Link', () => setLinkOpen(true), editor.isActive('link'), 'Insert link')}
          {tb('☰ Subpages', () => cmd((c) => c.insertContent({ type: 'subpages' }).run()), false, 'Insert a list of this page’s subpages')}
          <span className="tb-sep" />
          {(['note', 'info', 'tip', 'warning'] as CalloutKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className="tb-btn"
              onClick={() => cmd((c) => c.toggleWrap('callout', { kind: k }).run())}
            >
              :{k}
            </button>
          ))}
          <span className="tb-sep" />
          {tb('▧ Section', () => cmd((c) => c.toggleWrap('section', { color: 'neutral' }).run()), false, 'Wrap in a coloured section')}
        </div>
      )}
      </div>

      <div className="editor-main">
        <div className="editor-column">
          <div className="editor-surface-host" ref={surfaceRef}>
            <EditorContent editor={editor} className="editor-surface" />
            {editor && <TableHoverControls editor={editor} hostRef={surfaceRef} />}
          </div>
        </div>
        {props.sidebar && <aside className="editor-aside">{props.sidebar}</aside>}
      </div>

      {linkOpen && <LinkDialog onInsert={insertLink} onClose={() => setLinkOpen(false)} />}
      {imageOpen && (
        <ImageDialog
          spaceId={props.spaceId}
          pageId={props.pageId}
          onInsert={insertImage}
          onClose={() => setImageOpen(false)}
        />
      )}
      {attachOpen && (
        <AttachDialog
          spaceId={props.spaceId}
          pageId={props.pageId}
          onInsert={insertAttachment}
          onClose={() => setAttachOpen(false)}
        />
      )}
    </div>
  );
}

/** One affordance: `bx`/`by` = button centre; `rx/ry/rw/rh` = its preview rect
 *  (a thin insertion line for a "+", or the shaded block for a delete). */
type Ctl = { index: number; bx: number; by: number; rx: number; ry: number; rw: number; rh: number };
type Quad = { colAdd: Ctl; colDel: Ctl; rowAdd: Ctl; rowDel: Ctl } | null;

const TrashIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </svg>
);

/**
 * Cursor-following table affordances. While hovering a cell you get, per axis, a
 * "+" sitting on the nearest division (centred on the cell) to insert there, and
 * a delete button just above the column "+" / beside the row "+". Hovering a "+"
 * previews the new line with a thick guide; hovering a delete shades the whole
 * column/row that would be removed.
 */
function TableHoverControls({
  editor,
  hostRef,
}: {
  editor: Editor;
  hostRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [quad, setQuad] = useState<Quad>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const sigRef = useRef('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const clear = () => {
      tableRef.current = null;
      sigRef.current = '';
      setQuad(null);
    };

    const onMove = (e: MouseEvent) => {
      const table = (e.target as HTMLElement).closest?.('table') as HTMLTableElement | null;
      if (!table) {
        // Keep controls alive while hovering just outside the table (over a button).
        const cur = tableRef.current;
        if (cur) {
          const r = cur.getBoundingClientRect();
          const m = 30;
          if (
            e.clientX < r.left - m ||
            e.clientX > r.right + m ||
            e.clientY < r.top - m ||
            e.clientY > r.bottom + m
          )
            clear();
        }
        return;
      }
      tableRef.current = table;
      const hr = host.getBoundingClientRect();
      const firstRow = table.querySelector('tr');
      const cells = firstRow ? (Array.from(firstRow.children) as HTMLElement[]) : [];
      if (!cells.length) return;
      const xs = cells.map((c) => c.getBoundingClientRect().left - hr.left);
      xs.push(cells[cells.length - 1].getBoundingClientRect().right - hr.left);
      const trs = Array.from(table.querySelectorAll('tr')) as HTMLElement[];
      const ys = trs.map((r) => r.getBoundingClientRect().top - hr.top);
      ys.push(trs[trs.length - 1].getBoundingClientRect().bottom - hr.top);
      const tTop = ys[0];
      const tBottom = ys[ys.length - 1];
      const tLeft = xs[0];
      const tRight = xs[xs.length - 1];
      const px = e.clientX - hr.left;
      const py = e.clientY - hr.top;

      const ci = xs.findIndex((x, i) => i < xs.length - 1 && px >= xs[i] && px < xs[i + 1]);
      const ri = ys.findIndex((y, i) => i < ys.length - 1 && py >= ys[i] && py < ys[i + 1]);
      if (ci < 0 || ri < 0) {
        if (sigRef.current !== '') {
          sigRef.current = '';
          setQuad(null);
        }
        return;
      }

      const cellCX = (xs[ci] + xs[ci + 1]) / 2;
      const cellCY = (ys[ri] + ys[ri + 1]) / 2;
      // The "+" snaps to whichever side of the cell the cursor is nearer.
      const colDivIdx = px < cellCX ? ci : ci + 1;
      const rowDivIdx = py < cellCY ? ri : ri + 1;
      const colDivX = xs[colDivIdx];
      const rowDivY = ys[rowDivIdx];

      const next: Quad = {
        // Insert-column "+" on the division, centred vertically on the cell; guide = vertical line.
        colAdd: { index: colDivIdx, bx: colDivX, by: cellCY, rx: colDivX, ry: tTop, rw: 0, rh: tBottom - tTop },
        // Delete-column OUTSIDE the table, above the current column; shade = the whole column.
        colDel: { index: ci, bx: cellCX, by: tTop - 24, rx: xs[ci], ry: tTop, rw: xs[ci + 1] - xs[ci], rh: tBottom - tTop },
        // Insert-row "+" on the division, centred horizontally on the cell; guide = horizontal line.
        rowAdd: { index: rowDivIdx, bx: cellCX, by: rowDivY, rx: tLeft, ry: rowDivY, rw: tRight - tLeft, rh: 0 },
        // Delete-row OUTSIDE the table, left of the current row; shade = the whole row.
        rowDel: { index: ri, bx: tLeft - 24, by: cellCY, rx: tLeft, ry: ys[ri], rw: tRight - tLeft, rh: ys[ri + 1] - ys[ri] },
      };
      const sig = `${colDivIdx}:${cellCY}:${ci}:${rowDivIdx}:${cellCX}:${ri}`;
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setQuad(next);
      }
    };

    host.addEventListener('mousemove', onMove);
    return () => host.removeEventListener('mousemove', onMove);
  }, [hostRef, editor]);

  /** Put the selection inside a specific cell (robust: hit-test the cell centre). */
  const selectCell = (cell: HTMLElement | undefined): boolean => {
    if (!cell) return false;
    const r = cell.getBoundingClientRect();
    const at = editor.view.posAtCoords({ left: r.left + r.width / 2, top: r.top + r.height / 2 });
    if (!at) return false;
    editor.chain().focus().setTextSelection(at.pos).run();
    return true;
  };
  const firstRowCells = () => {
    const fr = tableRef.current?.querySelector('tr');
    return fr ? (Array.from(fr.children) as HTMLElement[]) : [];
  };
  const allRows = () => Array.from(tableRef.current?.querySelectorAll('tr') ?? []) as HTMLElement[];

  const insertColumn = (divIdx: number) => {
    const cells = firstRowCells();
    const n = cells.length;
    if (!selectCell(cells[Math.min(divIdx, n - 1)])) return;
    if (divIdx >= n) editor.chain().focus().addColumnAfter().run();
    else editor.chain().focus().addColumnBefore().run();
  };
  const deleteColumn = (ci: number) => {
    if (!selectCell(firstRowCells()[ci])) return;
    editor.chain().focus().deleteColumn().run();
  };
  const insertRow = (divIdx: number) => {
    const trs = allRows();
    const m = trs.length;
    if (!selectCell(trs[Math.min(divIdx, m - 1)]?.querySelector('th,td') as HTMLElement)) return;
    if (divIdx >= m) editor.chain().focus().addRowAfter().run();
    else editor.chain().focus().addRowBefore().run();
  };
  const deleteRow = (ri: number) => {
    if (!selectCell(allRows()[ri]?.querySelector('th,td') as HTMLElement)) return;
    editor.chain().focus().deleteRow().run();
  };

  if (!quad) return <div className="tbl-controls" aria-hidden />;
  const { colAdd, colDel, rowAdd, rowDel } = quad;
  const press = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  return (
    <div className="tbl-controls" aria-hidden>
      {/* Delete-column (above the +) and its shade. */}
      <button className="tbl-ctl tbl-del" title="Delete this column" style={{ left: colDel.bx, top: colDel.by }} onMouseDown={press(() => deleteColumn(colDel.index))}>
        <TrashIcon />
      </button>
      <div className="tbl-shade" style={{ left: colDel.rx, top: colDel.ry, width: colDel.rw, height: colDel.rh }} />

      {/* Insert-column "+" and its guide line. */}
      <button className="tbl-ctl tbl-add" title="Insert column here" style={{ left: colAdd.bx, top: colAdd.by }} onMouseDown={press(() => insertColumn(colAdd.index))}>
        +
      </button>
      <div className="tbl-guide tbl-guide-v" style={{ left: colAdd.rx, top: colAdd.ry, height: colAdd.rh }} />

      {/* Delete-row (beside the +) and its shade. */}
      <button className="tbl-ctl tbl-del" title="Delete this row" style={{ left: rowDel.bx, top: rowDel.by }} onMouseDown={press(() => deleteRow(rowDel.index))}>
        <TrashIcon />
      </button>
      <div className="tbl-shade" style={{ left: rowDel.rx, top: rowDel.ry, width: rowDel.rw, height: rowDel.rh }} />

      {/* Insert-row "+" and its guide line. */}
      <button className="tbl-ctl tbl-add" title="Insert row here" style={{ left: rowAdd.bx, top: rowAdd.by }} onMouseDown={press(() => insertRow(rowAdd.index))}>
        +
      </button>
      <div className="tbl-guide tbl-guide-h" style={{ top: rowAdd.ry, left: rowAdd.rx, width: rowAdd.rw }} />
    </div>
  );
}
