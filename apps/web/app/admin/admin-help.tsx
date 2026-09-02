'use client';

import { useState } from 'react';
import { InfoIcon } from '../components/ai-icons';

/**
 * The admin pages' shared help affordance: a small toggle that keeps
 * explanatory prose out of the way until asked for.
 */
export function AdminHelp({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="admin-help-wrap">
      <button
        type="button"
        className="tb-btn tokens-help-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <InfoIcon size={14} /> {open ? 'Hide help' : 'Help'}
      </button>
      {open && <div className="admin-help-panel">{children}</div>}
    </span>
  );
}
