/**
 * Instant loading state for document-portal navigations (page views, spaces).
 * Keeps the chrome + NavTree responsive while the server component fetches.
 */
export default function RootLoading() {
  return (
    <div aria-busy="true" style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
      <div className="skeleton" style={{ height: 34, width: 320 }} />
      <div className="skeleton" style={{ height: 14, width: 520 }} />
      <div className="skeleton" style={{ height: 14, width: 480 }} />
      <div className="skeleton" style={{ height: 180 }} />
    </div>
  );
}
