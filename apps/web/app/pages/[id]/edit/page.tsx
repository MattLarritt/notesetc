import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getComments, getMaintenance, getPage, listTemplates } from '../../../../lib/api';
import { pageRefFromParam, pageUrl } from '../../../../lib/page-url';
import { PageEditor } from '../../../components/editor';
import { PageSettingsPanel } from '../page-settings-panel';
import { loadProposalItems } from '../proposal-data';
import { renderComments } from '../comment-render';

export const dynamic = 'force-dynamic';

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ref = pageRefFromParam(id);
  const detail = await getPage(ref);

  // Viewers can't edit — send them to the read view rather than a dead-end editor.
  if (detail && !detail.capabilities.edit) redirect(pageUrl(detail.page));

  if (!detail) {
    return (
      <div className="doc">
        <h1>Page not found</h1>
        <Link href="/spaces">← Spaces</Link>
      </div>
    );
  }

  const { page, version, capabilities: can } = detail;

  // Data for the right-hand "Page settings" console. Templates only fetched when
  // the user can manage them (the API gates it to space-admins anyway).
  const [maintenance, templates, proposalItems, commentData] = await Promise.all([
    getMaintenance(page.id),
    can.manageTemplates ? listTemplates(page.spaceId) : Promise.resolve([]),
    can.review || can.propose ? loadProposalItems(page.id) : Promise.resolve([]),
    getComments(page.id),
  ]);

  const settings = maintenance ? (
    <PageSettingsPanel
      pageId={page.id}
      spaceId={page.spaceId}
      parentId={page.parentId}
      title={page.title}
      status={page.status}
      currentVersionId={page.currentVersionId}
      capabilities={can}
      maintenance={maintenance}
      templates={templates}
      childTemplateId={page.childTemplateId ?? null}
      proposalItems={proposalItems}
      commentItems={commentData ? renderComments(commentData.comments) : []}
      canComment={commentData?.canComment ?? false}
    />
  ) : undefined;

  return (
    <PageEditor
      mode="edit"
      pageId={page.id}
      spaceId={page.spaceId}
      baseVersionNumber={version?.versionNumber ?? 1}
      initialTitle={page.title}
      initialMarkdown={version?.content ?? ''}
      initialIcon={page.icon}
      cancelHref={pageUrl(page)}
      sidebar={settings}
    />
  );
}
