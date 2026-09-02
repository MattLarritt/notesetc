import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getPage } from '../../../../lib/api';
import { pageRefFromParam, pageUrl } from '../../../../lib/page-url';
import { PageEditor } from '../../../components/editor';

export const dynamic = 'force-dynamic';

export default async function ProposePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPage(pageRefFromParam(id));

  // Only those who can propose (or review) reach the propose editor.
  if (detail && !detail.capabilities.propose && !detail.capabilities.review) redirect(pageUrl(detail.page));

  if (!detail) {
    return (
      <div className="doc">
        <h1>Page not found</h1>
        <Link href="/spaces">← Spaces</Link>
      </div>
    );
  }

  const { page, version } = detail;
  return (
    <PageEditor
      mode="propose"
      pageId={page.id}
      spaceId={page.spaceId}
      initialTitle={page.title}
      initialMarkdown={version?.content ?? ''}
      cancelHref={`/pages/${page.id}`}
    />
  );
}
