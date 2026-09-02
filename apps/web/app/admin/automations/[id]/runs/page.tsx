import { redirect } from 'next/navigation';

export default async function AutomationRunsRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/automations/runs?automationId=${id}`);
}
