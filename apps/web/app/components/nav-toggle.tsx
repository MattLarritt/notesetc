'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';

/**
 * Mobile sidebar control. On narrow screens the nav becomes an off-canvas
 * drawer; this button toggles it (via a body class so pure CSS positions the
 * drawer), the overlay closes it, and any navigation closes it.
 */
export function NavToggle() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  const close = () => document.body.classList.remove('nav-open');

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    close();
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        aria-label="Toggle navigation"
        onClick={() => document.body.classList.toggle('nav-open')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M4 7 h16 M4 12 h16 M4 17 h16" />
        </svg>
      </button>
      {/* Portaled to <body>: inside the sticky title bar it would inherit that
          bar's stacking context and sit ABOVE the drawer, dimming it and eating
          every tap. */}
      {mounted && createPortal(<div className="nav-overlay" onClick={close} aria-hidden />, document.body)}
    </>
  );
}
