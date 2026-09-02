'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RenderedComment } from './comment-render';

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

function countActive(nodes: RenderedComment[]): number {
  return nodes.reduce((n, c) => n + (c.deleted ? 0 : 1) + countActive(c.replies), 0);
}

/** Page discussion in a modal (opened from a button near Edit/History), so the
 *  document itself stays clean. Threaded (one level of replies) with edit,
 *  soft-delete, and resolve. Bodies are pre-rendered on the server. */
export function CommentsModal({
  pageId,
  comments,
  canComment,
  triggerClass,
  triggerLabel = 'Comments',
}: {
  pageId: string;
  comments: RenderedComment[];
  canComment: boolean;
  triggerClass: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch(`/api/bff${path}`, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok && res.status !== 204) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setError(b.message ?? 'Request failed.');
        return false;
      }
      router.refresh(); // re-renders the server component; comments prop updates live
      return true;
    } finally {
      setBusy(false);
    }
  }

  const post = async () => {
    if (!draft.trim()) return;
    if (await send(`/pages/${pageId}/comments`, 'POST', { body: draft })) setDraft('');
  };
  const reply = async (parentId: string) => {
    if (!replyText.trim()) return;
    if (await send(`/pages/${pageId}/comments`, 'POST', { body: replyText, parentId })) {
      setReplyText('');
      setReplyTo(null);
    }
  };
  const saveEdit = async (id: string) => {
    if (!editText.trim()) return;
    if (await send(`/comments/${id}`, 'PATCH', { body: editText })) {
      setEditId(null);
      setEditText('');
    }
  };
  const del = async (id: string) => {
    if (confirm('Delete this comment?')) await send(`/comments/${id}`, 'DELETE');
  };
  const setResolved = (id: string, resolved: boolean) => send(`/comments/${id}/resolve`, 'POST', { resolved });

  const count = countActive(comments);

  const Meta = ({ c }: { c: RenderedComment }) => (
    <span className="comment-meta">
      <span className="comment-author">{c.authorType !== 'human' && '🤖 '}{c.authorLabel}</span>
      <span> · {new Date(c.createdAt).toLocaleString()}</span>
      {c.editedAt && <span> · edited</span>}
    </span>
  );

  const Actions = ({ c, isRoot }: { c: RenderedComment; isRoot: boolean }) => (
    <div className="comment-actions">
      {isRoot && canComment && !c.resolved && (
        <button className="link-btn" disabled={busy} onClick={() => { setReplyTo(c.id); setReplyText(''); }}>Reply</button>
      )}
      {c.canEdit && (
        <button className="link-btn" disabled={busy} onClick={() => { setEditId(c.id); setEditText(c.body); }}>Edit</button>
      )}
      {c.canDelete && <button className="link-btn" disabled={busy} onClick={() => del(c.id)}>Delete</button>}
      {isRoot && c.canResolve && (
        <button className="link-btn" disabled={busy} onClick={() => setResolved(c.id, !c.resolved)}>
          {c.resolved ? 'Reopen' : 'Resolve'}
        </button>
      )}
    </div>
  );

  const Body = ({ c }: { c: RenderedComment }) =>
    editId === c.id ? (
      <div className="comment-edit">
        <textarea className="field comment-textarea" value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
        <div className="comment-compose-actions">
          <button className="btn-primary" disabled={busy} onClick={() => saveEdit(c.id)}>Save</button>
          <button className="btn-secondary" disabled={busy} onClick={() => setEditId(null)}>Cancel</button>
        </div>
      </div>
    ) : c.deleted ? (
      <p className="comment-deleted">This comment was deleted.</p>
    ) : (
      <div className="comment-body prose" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
    );

  const Thread = ({ c }: { c: RenderedComment }) => (
    <li className={`comment ${c.resolved ? 'comment-resolved' : ''}`}>
      <div className="comment-head">
        <Meta c={c} />
        {c.resolved && <span className="comment-resolved-badge">✓ Resolved{c.resolvedByLabel ? ` · ${c.resolvedByLabel}` : ''}</span>}
      </div>
      <Body c={c} />
      <Actions c={c} isRoot />
      {replyTo === c.id && (
        <div className="comment-compose comment-reply">
          <textarea className="field comment-textarea" value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder="Write a reply…" autoFocus />
          <div className="comment-compose-actions">
            <button className="btn-primary" disabled={busy} onClick={() => reply(c.id)}>Reply</button>
            <button className="btn-secondary" disabled={busy} onClick={() => setReplyTo(null)}>Cancel</button>
          </div>
        </div>
      )}
      {c.replies.length > 0 && (
        <ul className="comment-replies">
          {c.replies.map((r) => (
            <li key={r.id} className="comment">
              <div className="comment-head"><Meta c={r} /></div>
              <Body c={r} />
              <Actions c={r} isRoot={false} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <>
      <button type="button" className={triggerClass} onClick={() => setOpen(true)}>
        {triggerLabel}
        {count > 0 && <span className="comment-count">{count}</span>}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" style={{ width: 'min(760px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Comments</strong>
              <button className="tb-btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body">
              {canComment ? (
                <div className="comment-compose">
                  <textarea
                    className="field comment-textarea"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    placeholder="Add a comment… (Markdown supported)"
                  />
                  <div className="comment-compose-actions">
                    <button className="btn-primary" disabled={busy || !draft.trim()} onClick={post}>Comment</button>
                  </div>
                </div>
              ) : (
                <p className="settings-hint">You need edit access to comment on this page.</p>
              )}

              {error && <div className="form-error">{error}</div>}

              {comments.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', marginBottom: 0 }}>No comments yet.</p>
              ) : (
                <ul className="comment-list">
                  {comments.map((c) => <Thread key={c.id} c={c} />)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
