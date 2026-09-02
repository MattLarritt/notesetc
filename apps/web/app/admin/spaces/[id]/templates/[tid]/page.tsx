import Link from 'next/link';
import { getTemplate } from '../../../../../../lib/api';
import { PageEditor } from '../../../../../components/editor';

export const dynamic = 'force-dynamic';

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string; tid: string }>;
}) {
  const { id, tid } = await params;
  const template = await getTemplate(tid);

  if (!template) {
    return (
      <div className="doc">
        <h1>Template not found</h1>
        <Link href={`/admin/spaces/${id}`}>← Space settings</Link>
      </div>
    );
  }

  return (
    <PageEditor
      mode="template"
      templateId={tid}
      initialTitle={template.name}
      initialMarkdown={template.content}
      cancelHref={`/admin/spaces/${id}`}
    />
  );
}
