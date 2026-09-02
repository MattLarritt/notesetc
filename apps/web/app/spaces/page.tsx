import Link from 'next/link';
import { listSpaces } from '../../lib/api';
import { getCurrentUser } from '../../lib/session';

export const dynamic = 'force-dynamic';

export default async function SpacesPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="doc">
        <h1>Spaces</h1>
        <p>
          Please <Link href="/login">sign in</Link> to view spaces.
        </p>
      </div>
    );
  }

  const spaces = await listSpaces();

  return (
    <div className="doc">
      <h1>Spaces</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Knowledgebase spaces you can access.</p>

      {spaces.length === 0 ? (
        <p>No spaces yet.</p>
      ) : (
        spaces.map((s) => (
          <Link key={s.id} href={`/spaces/${s.id}`} className="space-card">
            <div className="k">{s.key}</div>
            <strong>{s.name}</strong>
            {s.description && (
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                {s.description}
              </div>
            )}
          </Link>
        ))
      )}
    </div>
  );
}
