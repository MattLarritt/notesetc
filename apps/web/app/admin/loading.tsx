/**
 * Instant loading state for admin section navigations. Renders inside the admin
 * layout (sidebar stays put) the moment a link is clicked, while the server
 * component fetches — so navigation paints immediately instead of blocking.
 */
export default function AdminLoading() {
  return (
    <div aria-busy="true" style={{ display: 'grid', gap: 14, maxWidth: 900 }}>
      <div className="skeleton" style={{ height: 30, width: 220 }} />
      <div className="skeleton" style={{ height: 14, width: 460 }} />
      <div className="skeleton" style={{ height: 220 }} />
    </div>
  );
}
