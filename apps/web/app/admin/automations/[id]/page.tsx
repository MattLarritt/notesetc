import Link from 'next/link';
import { getAutomation } from '../../../../lib/api';
import { AutomationEditor } from './automation-editor';
import { TestPanel } from './test-panel';

export const dynamic = 'force-dynamic';

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const automation = await getAutomation(id);
  if (!automation) {
    return <p>Automation not found.</p>;
  }
  return (
    <div>
      <div className="page-actions">
        <h2 style={{ marginTop: 0 }}>{automation.name}</h2>
        <span style={{ flex: 1 }} />
        <Link className="btn-secondary" href={`/admin/automations/${id}/runs`}>
          Run history
        </Link>
      </div>
      <AutomationEditor automation={automation} />
      <TestPanel automationId={id} />
    </div>
  );
}
