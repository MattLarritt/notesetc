import Link from 'next/link';
import { searchPages } from '../../lib/api';
import { getCurrentUser } from '../../lib/session';
import { AppIcon } from '../components/app-icon';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await getCurrentUser();
  const query = (q ?? '').trim();

  if (!user) {
    return (
      <div className="doc">
        <h1>Search</h1>
        <p>
          Please <Link href="/login">sign in</Link> to search.
        </p>
      </div>
    );
  }

  const results = query.length >= 2 ? await searchPages(query) : [];

  return (
    <div className="doc">
      <h1>Search</h1>
      {query.length < 2 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Type at least 2 characters to search.</p>
      ) : (
        <p style={{ color: 'var(--color-text-muted)' }}>
          {results.length} result{results.length === 1 ? '' : 's'} for “{query}”
        </p>
      )}

      {results.map((r) => (
        <Link key={r.pageId} href={`/pages/${r.pageId}`} className="search-result">
          <AppIcon icon={r.icon || 'ms:description'} size={20} className="search-result-icon" />
          <div>
            <div className="search-result-title">
              {r.title}
              {r.status !== 'published' && <span className={`badge ${r.status}`}>{r.status}</span>}
            </div>
            {r.snippet && <div className="search-result-snippet">{r.snippet}</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}
