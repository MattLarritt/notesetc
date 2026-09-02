import { listUsers } from '../../../lib/api';
import { getCurrentUser } from '../../../lib/session';
import { AdminHelp } from '../admin-help';
import { CreateUser } from './create-user';
import { UserActions } from './user-actions';

export const dynamic = 'force-dynamic';

export default async function AdminUsers() {
  const [users, me] = await Promise.all([listUsers(), getCurrentUser()]);

  return (
    <div>
      <div className="page-actions">
        <h2 style={{ margin: 0 }}>Users</h2>
        <AdminHelp>
          <p>Local accounts. Enterprise SSO users appear here automatically after their first
          sign-in. Prefer disabling accounts over deleting them — history and audit entries
          stay attributed.</p>
        </AdminHelp>
        <span style={{ flex: 1 }} />
        <CreateUser />
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Source</th>
            <th>Role</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ opacity: u.status === 'disabled' ? 0.6 : 1 }}>
              <td className="mono">{u.email}</td>
              <td>
                {u.displayName}
                {u.isBreakglass && <span className="badge draft" style={{ marginLeft: 6 }}>breakglass</span>}
              </td>
              <td>{u.authSource}</td>
              <td>
                {u.globalRole === 'global_admin' ? (
                  <span className="badge published">global admin</span>
                ) : (
                  'member'
                )}
              </td>
              <td>
                <span className={`badge ${u.status === 'active' ? 'published' : 'archived'}`}>{u.status}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <UserActions
                  userId={u.id}
                  status={u.status}
                  isBreakglass={u.isBreakglass}
                  isSelf={me?.userId === u.id}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
