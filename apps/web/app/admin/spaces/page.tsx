import Link from 'next/link';
import { listSpaces } from '../../../lib/api';
import { AdminHelp } from '../admin-help';
import { CreateSpace } from './create-space';
import { ArchiveToggle } from './space-actions';

export const dynamic = 'force-dynamic';

export default async function AdminSpaces() {
  const spaces = await listSpaces(true); // include archived

  return (
    <div>
      <div className="page-actions">
        <h2 style={{ margin: 0 }}>Spaces</h2>
        <AdminHelp>
          <p>Spaces are the top-level containers for pages. Access is granted per space
          (viewer / editor / space admin) to users or groups. Archiving hides a space
          without deleting anything.</p>
        </AdminHelp>
        <span style={{ flex: 1 }} />
        <CreateSpace />
      </div>

      {spaces.length === 0 ? (
        <p>No spaces yet.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {spaces.map((s) => (
              <tr key={s.id} style={{ opacity: s.status === 'archived' ? 0.6 : 1 }}>
                <td className="mono">{s.key}</td>
                <td>
                  <Link href={`/admin/spaces/${s.id}`}>{s.name}</Link>
                </td>
                <td>
                  <span className={`badge ${s.status === 'archived' ? 'archived' : 'published'}`}>
                    {s.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link href={`/admin/spaces/${s.id}`} className="btn-secondary" style={{ marginRight: 6 }}>
                    Settings
                  </Link>
                  <ArchiveToggle spaceId={s.id} status={s.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
