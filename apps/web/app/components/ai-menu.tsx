'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AiFileDialog } from './ai-file-dialog';
import { SparkIcon } from './ai-icons';

/**
 * Top-right AI menu (spark mark), shown only when the admin enabled the assistant.
 * Two entries: file a document with AI, and chat with the wiki-aware agent.
 */
export function AiMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-label="AI menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title="AI assistant"
        onClick={() => setOpen((v) => !v)}
      >
        <SparkIcon size={20} />
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="user-menu-head">
            <SparkIcon size={16} />
            <span className="user-menu-email">AI assistant</span>
          </div>
          <div className="user-menu-sep" />
          <button className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); setFileOpen(true); }}>
            File a document…
          </button>
          <button className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); router.push('/ai'); }}>
            Chat with your notes
          </button>
        </div>
      )}
      {fileOpen && <AiFileDialog onClose={() => setFileOpen(false)} />}
    </div>
  );
}
