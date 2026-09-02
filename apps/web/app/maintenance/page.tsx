import Link from 'next/link';
import { listMyMaintenance, listSpaces, type ReviewStatus } from '../../lib/api';
import { MarkReviewedButton } from './mark-reviewed-button';

export const dynamic = 'force-dynamic';

const STATUS: Record<ReviewStatus, { text: string; bg: string; color: string }> = {
  overdue: { text: 'Overdue', bg: '#fdeaea', color: '#c0392b' },
  due_soon: { text: 'Due soon', bg: '#fdf2e6', color: '#b8730b' },
  ok: { text: 'Up to date', bg: '#e6f4ea', color: '#1e7d34' },
  none: { text: 'No date set', bg: 'var(--nav-bg)', color: 'var(--color-text-muted)' },
};

export default async function MyMaintenancePage() {
  const [items, spaces] = await Promise.all([listMyMaintenance(), listSpaces(true)]);
  const spaceName = new Map(spaces.map((s) => [s.id, s.name]));

  return (
    <div className="doc-wide">
      <div className="doc">
        <h1>My maintenance</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Documents you’re responsible for reviewing — directly or via a group you belong to —
          sorted by review date, most urgent first.
        </p>

        {items.length === 0 ? (
          <div className="callout note">You’re not assigned as a maintainer on any documents.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Space</th>
                <th>Review due</th>
                <th>Status</th>
                <th>Last reviewed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const s = STATUS[it.reviewStatus];
                return (
                  <tr key={it.id}>
                    <td>
                      <Link href={`/pages/${it.id}`}>{it.title}</Link>
                    </td>
                    <td>{spaceName.get(it.spaceId) ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {it.reviewDueAt ? new Date(it.reviewDueAt).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      <span style={{ background: s.bg, color: s.color, padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600 }}>
                        {s.text}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                      {it.lastReviewedAt ? new Date(it.lastReviewedAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <MarkReviewedButton pageId={it.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
