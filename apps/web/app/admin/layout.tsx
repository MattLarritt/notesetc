import type { ReactNode } from 'react';
import Link from 'next/link';
import { getCurrentUser } from '../../lib/session';
import { AdminSidebar } from './admin-nav';

export const dynamic = 'force-dynamic';

/**
 * Admin portal shell. Gated to global admins — the API enforces the same on
 * every endpoint, this is the UI-side guard so non-admins never see the surface.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="doc">
        <h1>Admin</h1>
        <p>
          Please <Link href="/login">sign in</Link>.
        </p>
      </div>
    );
  }

  if (user.globalRole !== 'global_admin') {
    return (
      <div className="doc">
        <h1>Admin</h1>
        <div className="form-error">You need global administrator access to view this area.</div>
      </div>
    );
  }

  return (
    <div className="admin">
      <AdminSidebar />
      <div className="admin-main">{children}</div>
    </div>
  );
}
