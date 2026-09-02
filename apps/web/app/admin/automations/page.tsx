import Link from 'next/link';
import { AdminHelp } from '../admin-help';
import { listAutomationRuns, listAutomations } from '../../../lib/api';
import { AutomationsList } from './automations-list';
import { VariablesManager } from './variables-manager';

export const dynamic = 'force-dynamic';

export default async function AdminAutomationsPage() {
  const [automations, recentRuns] = await Promise.all([
    listAutomations(),
    listAutomationRuns({}),
  ]);
  // Latest run per automation for the list's status column.
  const lastRun: Record<string, (typeof recentRuns)[number]> = {};
  for (const r of recentRuns) {
    if (!lastRun[r.automationId]) lastRun[r.automationId] = r; // newest-first order
  }
  return (
    <div>
      <div className="page-actions">
        <h2 style={{ margin: 0 }}>Automations</h2>
        <AdminHelp>
          <p>JavaScript that runs inside Notes Etc — on page events, a schedule, or a webhook.
          Scripts use the <code>netc</code> API, run sandboxed with a timeout, and can be
          dry-run safely in Mock Mode before being enabled.</p>
        </AdminHelp>
        <span style={{ flex: 1 }} />
        <Link className="btn-secondary" href="/admin/automations/runs">
          Run logs
        </Link>
        <Link className="btn-primary" href="/admin/automations/new">
          New automation
        </Link>
      </div>
      <AutomationsList automations={automations} lastRun={lastRun} />
      <VariablesManager />
    </div>
  );
}
