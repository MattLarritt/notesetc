import { resolveNewPageTemplate } from '../../../../lib/api';
import { PageEditor } from '../../../components/editor';

export const dynamic = 'force-dynamic';

export default async function NewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ parent?: string }>;
}) {
  const { id } = await params;
  const { parent } = await searchParams;
  // Pre-fill the body from the parent's subpage template → space default → blank.
  const template = await resolveNewPageTemplate(id, parent);
  return (
    <PageEditor
      mode="create"
      spaceId={id}
      parentId={parent}
      initialMarkdown={template?.content ?? ''}
      cancelHref={`/spaces/${id}`}
    />
  );
}
