'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Dedicated admin sidebar: grouped sections with icons, replacing the old tab
 * strip. Active state matches by path prefix so sub-pages (e.g. an automation's
 * editor or run detail) keep their section highlighted.
 */

interface Item {
  href: string;
  icon: string; // Material Symbols name (self-hosted)
  label: string;
  soon?: boolean;
}

const GROUPS: Array<{ label: string; items: Item[] }> = [
  {
    label: 'Content',
    items: [{ href: '/admin/spaces', icon: 'space_dashboard', label: 'Spaces' }],
  },
  {
    label: 'People',
    items: [
      { href: '/admin/users', icon: 'person', label: 'Users' },
      { href: '/admin/groups', icon: 'group', label: 'Groups' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { href: '/admin/tokens', icon: 'key', label: 'API tokens' },
      { href: '/admin/automations', icon: 'smart_toy', label: 'Automations' },
      { href: '/admin/ai', icon: 'auto_awesome', label: 'AI agent' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/audit', icon: 'receipt_long', label: 'Audit log' },
      { href: '/admin/settings', icon: 'settings', label: 'Settings', soon: true },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <nav className="admin-side" aria-label="Administration">
      <div className="admin-side-title">
        <span className="material-symbols-outlined">shield_person</span>
        Administration
      </div>
      {GROUPS.map((g) => (
        <div key={g.label} className="admin-side-group">
          <div className="admin-side-label">{g.label}</div>
          {g.items.map((item) => {
            if (item.soon) {
              return (
                <span key={item.href} className="admin-side-link soon" title="Coming soon">
                  <span className="material-symbols-outlined">{item.icon}</span>
                  {item.label}
                </span>
              );
            }
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="admin-side-link"
                data-active={active || undefined}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <Link href="/" className="admin-side-link" style={{ opacity: 0.75 }}>
        <span className="material-symbols-outlined">arrow_back</span>
        Back to Notes Etc
      </Link>
    </nav>
  );
}
