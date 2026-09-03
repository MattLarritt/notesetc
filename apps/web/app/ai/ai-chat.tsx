'use client';

import MarkdownIt from 'markdown-it';
import { useEffect, useRef, useState } from 'react';
import { HistoryIcon, MemoryIcon, PlusIcon, SendIcon, SparkIcon, TrashIcon } from '../components/ai-icons';

/**
 * The AI chat: an obvious chat surface, nothing else. Every exchange is
 * persisted server-side per user; "Revisit past chats" reopens one. Replies
 * carry a "sources" row naming the notes the agent read.
 */

interface Trace {
  tool: string;
  summary: string;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  trace?: Trace[];
}
interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

// html:false — model output renders as Markdown only, never raw HTML.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const TRACE_LABELS: Record<string, string> = {
  search_pages: 'Searched',
  get_page: 'Read',
  list_pages: 'Browsed pages',
  list_spaces: 'Browsed spaces',
  list_attachments: 'Browsed documents',
  get_attachment_text: 'Read document',
  web_search: 'Searched the web',
  update_memory: 'Remembered',
  create_space: 'Created space',
  update_space: 'Renamed space',
  archive_space: 'Archived space',
  unarchive_space: 'Restored space',
  create_page: 'Created page',
  update_page: 'Updated page',
  publish_page: 'Published',
  automation_docs: 'Read automation docs',
  list_automations: 'Browsed automations',
  get_automation: 'Read automation',
  create_automation: 'Created automation',
  update_automation: 'Updated automation',
  test_automation: 'Tested automation',
  get_automation_run: 'Checked run',
  list_automation_variables: 'Browsed variables',
  set_automation_variable: 'Set variable',
};

async function csrf(): Promise<string> {
  const res = await fetch('/api/bff/auth/csrf', { credentials: 'include' });
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  return csrfToken;
}

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function AiChat({ initialChatId = null }: { initialChatId?: string | null }) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pastChats, setPastChats] = useState<ChatSummary[] | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memory, setMemory] = useState<{ key: string; value: string }[] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Deep link: /ai?chat=<id> ("Revisit this chat" from a page the AI created).
  useEffect(() => {
    if (initialChatId) void loadChat(initialChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId]);

  function autoGrow() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    requestAnimationFrame(autoGrow);
    setBusy(true);
    try {
      const token = await csrf();
      const res = await fetch('/api/bff/ai/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ message: text, ...(chatId ? { chatId } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        chatId?: string;
        reply?: string;
        trace?: Trace[];
        message?: string;
      };
      if (!res.ok || data.reply == null) {
        setError(data.message ?? `The assistant failed (${res.status}).`);
        return;
      }
      if (data.chatId) setChatId(data.chatId);
      setMessages((m) => [...m, { role: 'assistant', content: data.reply!, trace: data.trace }]);
    } catch {
      setError('Could not reach the assistant.');
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setChatId(null);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function openHistory() {
    setHistoryOpen(true);
    setPastChats(null);
    try {
      const res = await fetch('/api/bff/ai/chats', { credentials: 'include' });
      setPastChats(res.ok ? ((await res.json()) as ChatSummary[]) : []);
    } catch {
      setPastChats([]);
    }
  }

  async function loadChat(id: string) {
    try {
      const res = await fetch(`/api/bff/ai/chats/${id}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { id: string; messages: Msg[] };
      setChatId(data.id);
      setMessages(data.messages);
      setHistoryOpen(false);
      setError(null);
    } catch {
      /* leave the modal open */
    }
  }

  async function openMemory() {
    setMemoryOpen(true);
    setMemory(null);
    try {
      const res = await fetch('/api/bff/ai/memory', { credentials: 'include' });
      setMemory(res.ok ? ((await res.json()) as { entries: { key: string; value: string }[] }).entries : []);
    } catch {
      setMemory([]);
    }
  }

  async function forgetFact(key: string) {
    try {
      const token = await csrf();
      await fetch(`/api/bff/ai/memory/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      setMemory((rows) => rows?.filter((r) => r.key !== key) ?? null);
    } catch {
      /* ignore */
    }
  }

  async function deleteChat(id: string) {
    try {
      const token = await csrf();
      await fetch(`/api/bff/ai/chats/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      setPastChats((rows) => rows?.filter((r) => r.id !== id) ?? null);
      if (chatId === id) newChat();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="ai-chat">
      <div className="ai-chat-bar">
        <span className="ai-chat-mark"><SparkIcon size={16} /></span>
        <span className="spacer" />
        <button type="button" className="ai-bar-btn" onClick={newChat} title="Start a new chat">
          <PlusIcon size={15} /> New chat
        </button>
        <button type="button" className="ai-bar-btn" onClick={openHistory}>
          <HistoryIcon size={15} /> Revisit past chats
        </button>
        <button type="button" className="ai-bar-btn" onClick={openMemory} title="What the assistant remembers about you">
          <MemoryIcon size={15} /> Memory
        </button>
      </div>

      <div className="ai-chat-log">
        {messages.length === 0 && !busy && (
          <div className="ai-chat-empty">
            <SparkIcon size={34} />
            <p>Ask anything about your notes</p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ai-msg-user">{m.content}</div>
          ) : (
            <div key={i} className="ai-msg-assistant">
              <span className="ai-msg-avatar"><SparkIcon size={14} /></span>
              <div className="ai-msg-body">
                {!!m.trace?.length && (
                  <div className="ai-trace">
                    <span className="ai-trace-lead">From your notes</span>
                    {m.trace.map((t, j) => (
                      <span key={j} className="ai-trace-chip">
                        {TRACE_LABELS[t.tool] ?? t.tool}: {t.summary}
                      </span>
                    ))}
                  </div>
                )}
                <div
                  className="prose"
                  // Markdown-only render (html:false above); output contains no raw HTML.
                  dangerouslySetInnerHTML={{ __html: md.render(m.content) }}
                />
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="ai-msg-assistant">
            <span className="ai-msg-avatar"><SparkIcon size={14} /></span>
            <div className="ai-msg-body ai-thinking">
              Reading your notes<span className="ai-dots"><i /><i /><i /></span>
            </div>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="ai-composer-wrap">
        <form
          className="ai-composer"
          onSubmit={(e) => { e.preventDefault(); void send(); }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder="Ask anything about your notes…"
            onChange={(e) => { setInput(e.target.value); autoGrow(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
          />
          <button className="ai-send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
            <SendIcon size={17} />
          </button>
        </form>
      </div>

      {memoryOpen && (
        <div className="modal-backdrop" onClick={() => setMemoryOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Memory</strong>
              <button className="tb-btn" onClick={() => setMemoryOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body ai-history">
              <p className="ai-muted" style={{ margin: '0 0 0.5rem' }}>
                Facts the assistant has saved from your chats. It reads these at the start of
                every conversation. Delete anything wrong or unwanted.
              </p>
              {memory == null && <p className="ai-muted">Loading…</p>}
              {memory?.length === 0 && <p className="ai-muted">Nothing remembered yet — it saves facts as you chat.</p>}
              {memory?.map((m) => (
                <div key={m.key} className="ai-history-row">
                  <span className="ai-memory-fact">
                    <b>{m.key.replace(/_/g, ' ')}</b>: {m.value}
                  </span>
                  <button
                    type="button"
                    className="ai-history-delete"
                    aria-label={`Forget ${m.key}`}
                    onClick={() => void forgetFact(m.key)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Past chats</strong>
              <button className="tb-btn" onClick={() => setHistoryOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="modal-body ai-history">
              {pastChats == null && <p className="ai-muted">Loading…</p>}
              {pastChats?.length === 0 && <p className="ai-muted">No saved chats yet.</p>}
              {pastChats?.map((c) => (
                <div key={c.id} className="ai-history-row">
                  <button type="button" className="ai-history-title" onClick={() => void loadChat(c.id)}>
                    {c.title}
                    <span className="ai-muted"> · {relTime(c.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="ai-history-delete"
                    aria-label="Delete chat"
                    onClick={() => void deleteChat(c.id)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
