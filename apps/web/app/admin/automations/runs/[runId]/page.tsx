import Link from 'next/link';
import { getAutomation, getAutomationRun } from '../../../../../lib/api';
import { RunDetail } from './run-detail';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const detail = await getAutomationRun(runId);
  if (!detail) return <p>Run not found.</p>;
  const automation = await getAutomation(detail.run.automationId);
  return (
    <div>
      <div className="page-actions">
        <h2 style={{ marginTop: 0 }}>
          Run of{' '}
          <Link href={`/admin/automations/${detail.run.automationId}`}>
            {automation?.name ?? 'automation'}
          </Link>
        </h2>
        <span style={{ flex: 1 }} />
        <Link className="btn-secondary" href="/admin/automations/runs">
          ← All runs
        </Link>
      </div>
      <RunDetail initialRun={detail.run} initialLogs={detail.logs} />
    </div>
  );
}
