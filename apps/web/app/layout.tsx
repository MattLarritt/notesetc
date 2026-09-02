import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getCurrentUser } from '../lib/session';
import { getAiStatus, listSpaces, listMyMaintenance } from '../lib/api';
import { NavTree } from './components/nav-tree';
import { SearchBox } from './components/search-box';
import { UserMenu } from './components/user-menu';
import { AiMenu } from './components/ai-menu';
import 'material-symbols/outlined.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Notes Etc',
  description: 'Enterprise IT knowledgebase',
};

/** Logo mark: a note page with a folded corner — the ellipsis is the "etc". */
function Logo() {
  return (
    <svg className="app-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 2 h7.5 L19.5 7 V19.5 A2.5 2.5 0 0 1 17 22 H7 A2.5 2.5 0 0 1 4.5 19.5 V4.5 A2.5 2.5 0 0 1 7 2 Z"
        fill="var(--brand-gold)"
      />
      <path d="M14.5 2 V7 H19.5 Z" fill="var(--brand-amber)" />
      <circle cx="8.6" cy="15.5" r="1.4" fill="var(--brand-navy)" />
      <circle cx="12" cy="15.5" r="1.4" fill="var(--brand-navy)" />
      <circle cx="15.4" cy="15.5" r="1.4" fill="var(--brand-navy)" />
    </svg>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  // The sidebar shows for signed-in users. For anonymous visitors it only shows
  // when public documents exist (listSpaces returns Public-shared spaces when
  // unauthenticated) — otherwise the chrome collapses to a clean sign-in page.
  const hasPublicSpaces = user ? false : (await listSpaces()).length > 0;
  const ai = user ? await getAiStatus() : { enabled: false };
  const showSidebar = !!user || hasPublicSpaces;

  // Maintenance badge: count items due within 30 days (incl. overdue); red if any
  // are overdue, amber if only due-soon, hidden if nothing due in the window.
  let dueCount = 0;
  let hasOverdue = false;
  if (user) {
    const now = Date.now();
    const HORIZON = 30 * 86_400_000;
    const due = (await listMyMaintenance()).filter(
      (m) => m.reviewDueAt && new Date(m.reviewDueAt).getTime() <= now + HORIZON,
    );
    dueCount = due.length;
    hasOverdue = due.some((m) => new Date(m.reviewDueAt as string).getTime() < now);
  }
  return (
    <html lang="en">
      <body>
        {/* Themed chrome */}
        <header className="app-titlebar">
          {/* Logo + wordmark link home (the document portal). */}
          <Link href="/" className="app-home-link" aria-label="Notes Etc home">
            <Logo />
            <span className="app-title">
              Notes<b>Etc</b>
            </span>
          </Link>
          {user && <SearchBox />}
          <span className="spacer" />
          {user && ai.enabled && <AiMenu />}
          {user ? (
            <UserMenu
              email={user.email}
              isAdmin={user.globalRole === 'global_admin'}
              dueCount={dueCount}
              hasOverdue={hasOverdue}
            />
          ) : (
            <a href="/login" style={{ color: 'var(--color-primary)' }}>
              Sign in
            </a>
          )}
        </header>

        <div className={`app-shell${showSidebar ? '' : ' no-nav'}`}>
          {/* Themed navigation tree (left sidebar). Hidden entirely for anonymous
              visitors unless there are public spaces to browse. */}
          {showSidebar && (
            <aside className="app-nav">
              <NavTree isGlobalAdmin={user?.globalRole === 'global_admin'} />
              {user && (
                <div className="nav-footer">
                  <a href="/docs" target="_blank" rel="noreferrer">
                    API docs ↗
                  </a>
                </div>
              )}
            </aside>
          )}

          {/* Low-theme, highly readable content surface */}
          <main className="app-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
