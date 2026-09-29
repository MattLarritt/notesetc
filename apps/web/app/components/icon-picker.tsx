'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from './app-icon';

/** The popover's width, and the gap it keeps from the button and the window edges. */
const POP_WIDTH = 340;
const GAP = 6;

/** Curated Material Symbols for fast picking (the "Quick" tab). */
const QUICK = [
  'folder', 'computer', 'engineering', 'security', 'groups', 'factory',
  'description', 'science', 'business', 'campaign', 'support_agent', 'build',
  'cloud', 'dns', 'lock', 'gavel', 'payments', 'inventory_2',
  'local_shipping', 'health_and_safety', 'school', 'handshake', 'rocket_launch',
  'terminal', 'settings', 'menu_book', 'bug_report', 'analytics',
];

type Tab = 'quick' | 'material' | 'apps';
interface Result {
  id: string;
  title?: string;
  svg?: string;
}

export function IconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('quick');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  /*
   * The popover is portalled to <body> and positioned against the button in viewport
   * coordinates. Rendered in place it was clipped by whatever scrolled or hid overflow
   * around it — the create-space modal cut it off at its bottom edge. Below the button
   * when there is room, above it when there isn't, and always inside the window.
   */
  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const height = pop.current?.offsetHeight ?? 320;
    const width = Math.min(POP_WIDTH, window.innerWidth - GAP * 2);
    const below = b.bottom + GAP;
    const top =
      below + height <= window.innerHeight - GAP || b.top - GAP - height < GAP
        ? Math.min(below, Math.max(GAP, window.innerHeight - GAP - height))
        : b.top - GAP - height;
    const left = Math.min(Math.max(GAP, b.left), window.innerWidth - GAP - width);
    setAt({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    place();
  }, [open, tab, results.length, place]);

  // Follow the button while open; close on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, place]);

  // Debounced search for the material / apps tabs.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (tab === 'quick') return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const set = tab === 'material' ? 'material' : 'apps';
        const res = await fetch(`/api/icons/search?set=${set}&q=${encodeURIComponent(query)}`);
        const data = (await res.json()) as { icons: Result[] };
        setResults(data.icons ?? []);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [tab, query]);

  function choose(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  const gridItems: Result[] = tab === 'quick' ? QUICK.map((n) => ({ id: `ms:${n}` })) : results;

  return (
    <div className="icon-picker">
      <button ref={button} type="button" className="icon-preview" onClick={() => setOpen((o) => !o)}>
        <AppIcon icon={value || 'folder'} size={22} />
        <span style={{ fontSize: '0.85rem' }}>{value ?? 'Choose icon'}</span>
      </button>

      {open && createPortal(
        <div
          ref={pop}
          className="icon-pop"
          style={{
            top: at?.top ?? 0,
            left: at?.left ?? 0,
            width: Math.min(POP_WIDTH, typeof window === 'undefined' ? POP_WIDTH : window.innerWidth - GAP * 2),
            // Measured before it is shown, so it never flashes at the corner of the page.
            visibility: at ? 'visible' : 'hidden',
          }}
        >
          <div className="icon-pop-tabs">
            {(['quick', 'material', 'apps'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className="tab"
                data-active={tab === t || undefined}
                onClick={() => {
                  setTab(t);
                  setResults([]);
                  setQuery('');
                }}
              >
                {t === 'quick' ? 'Quick' : t === 'material' ? 'Material' : 'Apps'}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button type="button" className="tab" onClick={() => choose(null)} title="Clear icon">
              Clear
            </button>
          </div>

          {tab !== 'quick' && (
            <input
              className="field"
              autoFocus
              placeholder={tab === 'material' ? 'Search Material Symbols…' : 'Search apps (azure, sap, salesforce…)'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          <div className="icon-grid">
            {loading && <div className="picker-empty">Searching…</div>}
            {!loading && gridItems.length === 0 && tab !== 'quick' && (
              <div className="picker-empty">
                {query ? 'No matches.' : 'Type to search.'}
              </div>
            )}
            {gridItems.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`icon-cell${value === r.id ? ' selected' : ''}`}
                title={r.title ?? r.id.replace(/^ms:/, '')}
                onClick={() => choose(r.id)}
              >
                <AppIcon icon={r.id} svg={r.svg} size={22} />
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
