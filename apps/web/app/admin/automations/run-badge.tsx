/** Small status badge for automation run states (shared by list/detail/console). */
export function RunBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    queued: { bg: '#eef0f4', fg: '#5a6072' },
    running: { bg: '#eef4fb', fg: '#2c5488' },
    success: { bg: '#eaf5ec', fg: '#1e7d34' },
    error: { bg: '#fcecea', fg: '#b23124' },
    timeout: { bg: '#fdf3e2', fg: '#a9650d' },
    killed: { bg: '#f2eefb', fg: '#5a37a3' },
    dead: { bg: '#f0f0f0', fg: '#777' },
  };
  const c = colors[status] ?? colors.dead;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.55rem',
        borderRadius: 999,
        fontSize: '0.72rem',
        fontWeight: 700,
        background: c.bg,
        color: c.fg,
      }}
    >
      {status}
    </span>
  );
}
