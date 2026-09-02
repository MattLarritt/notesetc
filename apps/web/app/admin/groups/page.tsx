import { listGroups, listUsers } from '../../../lib/api';
import { AdminHelp } from '../admin-help';
import { GroupsManager } from './groups-manager';

export const dynamic = 'force-dynamic';

export default async function AdminGroupsPage() {
  const [groups, users] = await Promise.all([listGroups(), listUsers()]);
  return (
    <div>
      <div className="page-actions">
        <h2 style={{ margin: 0 }}>Groups</h2>
        <AdminHelp>
          <p>Grant space permissions to many people at once. Built in: <strong>Administrators</strong>
          {' '}(members are the global admins), <strong>All Users</strong> (every signed-in account)
          and <strong>Public</strong> (grants apply to anonymous visitors too).</p>
        </AdminHelp>
      </div>
      <GroupsManager groups={groups} users={users} />
    </div>
  );
}
