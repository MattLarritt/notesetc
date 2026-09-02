/**
 * Small inline SVG icons for the AI surfaces. Drawn here rather than emoji or
 * icon-font glyphs so they inherit currentColor and match both themes.
 */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Four-point spark — the AI mark. */
export function SparkIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 3 L14 9.5 L21 12 L14 14.5 L12 21 L10 14.5 L3 12 L10 9.5 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SendIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 19 V5" />
      <path d="M6 11 L12 5 L18 11" />
    </svg>
  );
}

export function HistoryIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5 V12 L15.5 14" />
    </svg>
  );
}

export function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 5 V19 M5 12 H19" />
    </svg>
  );
}

export function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M4 7 H20 M9 7 V5 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 1 1 V7 M6.5 7 L7.5 20 a1 1 0 0 0 1 1 h7 a1 1 0 0 0 1-1 L17.5 7" />
    </svg>
  );
}

export function DocIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M7 3 h7 l4 4 v13 a1 1 0 0 1 -1 1 H7 a1 1 0 0 1 -1-1 V4 a1 1 0 0 1 1-1 Z" />
      <path d="M14 3 V7 H18" />
    </svg>
  );
}

export function RefreshIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 12 a8 8 0 1 1 -2.34 -5.66" />
      <path d="M20 3 V7 H16" />
    </svg>
  );
}

export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12.5 L9.5 18 L20 6.5" />
    </svg>
  );
}

export function MemoryIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4 a4 4 0 0 1 4 4 v8 a4 4 0 0 1 -8 0 V8 a4 4 0 0 1 4 -4 Z" />
      <path d="M8 10 H4.5 M8 14 H4.5 M16 10 H19.5 M16 14 H19.5" />
    </svg>
  );
}

export function InfoIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11 V16.5" />
      <circle cx="12" cy="7.8" r="0.4" fill="currentColor" />
    </svg>
  );
}

export function LockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5 V7.5 a4 4 0 0 1 8 0 V10.5" />
    </svg>
  );
}
