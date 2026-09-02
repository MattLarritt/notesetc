'use client';

import { useEffect, useRef, useState } from 'react';
import { AppIcon } from './app-icon';

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
      <button type="button" className="icon-preview" onClick={() => setOpen((o) => !o)}>
        <AppIcon icon={value || 'folder'} size={22} />
        <span style={{ fontSize: '0.85rem' }}>{value ?? 'Choose icon'}</span>
      </button>

      {open && (
        <div className="icon-pop">
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
        </div>
      )}
    </div>
  );
}
