import Link from 'next/link';
import { getSpace, listGrants, listGroups, listTemplates, listUsers } from '../../../../lib/api';
import { ArchiveToggle } from '../space-actions';
import { EditSpace } from './edit-space';
import { GrantsEditor } from './grants-editor';
import { TemplatesSection } from './templates-section';

export const dynamic = 'force-dynamic';

export default async function AdminSpaceSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const space = await getSpace(id);

  const [grants, users, groups, templates] = space
    ? await Promise.all([listGrants(id), listUsers(), listGroups(), listTemplates(id)])
    : [[], [], [], []];

  if (!space) {
    return (
      <div>
        <p>
          <Link href="/admin/spaces">← Spaces</Link>
        </p>
        <div className="form-error">Space not found.</div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: '0.85rem' }}>
        <Link href="/admin/spaces">← Spaces</Link>
      </p>
      <div className="page-actions" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {space.name}{' '}
          <span className={`badge ${space.status === 'archived' ? 'archived' : 'published'}`}>
            {space.status}
          </span>
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href={`/spaces/${space.id}`} className="btn-secondary">
            View pages
          </Link>
          <ArchiveToggle spaceId={space.id} status={space.status} />
        </div>
      </div>

      <EditSpace space={space} />

      <GrantsEditor spaceId={space.id} grants={grants} users={users} groups={groups} />

      <TemplatesSection spaceId={space.id} templates={templates} defaultTemplateId={space.defaultTemplateId ?? null} />
    </div>
  );
}
