import Link from 'next/link';
import { getSpace } from '../../../../../lib/api';
import { PageEditor } from '../../../../components/editor';

export const dynamic = 'force-dynamic';

export default async function EditOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const space = await getSpace(id);

  if (!space) {
    return (
      <div className="doc">
        <h1>Space not found</h1>
        <Link href="/spaces">← Spaces</Link>
      </div>
    );
  }

  return (
    <PageEditor
      mode="space-overview"
      spaceId={space.id}
      heading={space.name}
      initialMarkdown={space.overview ?? ''}
      cancelHref={`/spaces/${space.id}`}
    />
  );
}
