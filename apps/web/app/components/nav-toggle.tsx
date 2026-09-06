'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Mobile sidebar control. On narrow screens the nav becomes an off-canvas
 * drawer; this button toggles it (via a body class so pure CSS positions the
 * drawer), the overlay closes it, and any navigation closes it.
 */
export function NavToggle() {
  const pathname = usePathname();

  const close = () => document.body.classList.remove('nav-open');

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
      <div className="nav-overlay" onClick={close} aria-hidden />
    </>
  );
}
