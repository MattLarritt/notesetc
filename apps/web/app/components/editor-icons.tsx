/**
 * Editor toolbar icons — inline SVG, currentColor, uniform 24×24 viewBox so
 * every toolbar button is the same size. Replaces the previous emoji/glyph
 * labels.
 */

type P = { size?: number };
const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconBold = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M7 5 h6 a3.5 3.5 0 0 1 0 7 H7 Z" />
    <path d="M7 12 h7 a3.5 3.5 0 0 1 0 7 H7 Z" />
  </svg>
);

export const IconItalic = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M10 5 h8 M6 19 h8 M14.5 5 L9.5 19" />
  </svg>
);

export const IconBulletList = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M9 6 h11 M9 12 h11 M9 18 h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconOrderedList = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M10 6 h10 M10 12 h10 M10 18 h10" />
    <path d="M4 5 L5 4.5 V8 M3.5 15 h1.6 a0.9 0.9 0 0 1 0.4 1.7 L3.5 19 h2" strokeWidth={1.5} />
  </svg>
);

export const IconQuote = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M9 7 C6.5 8 5.5 10 5.5 12.5 H9 V17 H4.5 V12 C4.5 8.5 6 7 9 7 Z" />
    <path d="M19 7 C16.5 8 15.5 10 15.5 12.5 H19 V17 H14.5 V12 C14.5 8.5 16 7 19 7 Z" />
  </svg>
);

export const IconCode = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M9 8 L5 12 L9 16 M15 8 L19 12 L15 16" />
  </svg>
);

export const IconDiagram = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <rect x="3" y="4" width="7" height="5" rx="1" />
    <rect x="14" y="9" width="7" height="5" rx="1" />
    <rect x="8.5" y="15" width="7" height="5" rx="1" />
    <path d="M10 6.5 h4 a2 2 0 0 1 2 2 M12 14 v0.5 a1 1 0 0 1 -1 1" />
  </svg>
);

export const IconTable = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <path d="M4 10 h16 M4 14.5 h16 M10 5 v14 M15 5 v14" />
  </svg>
);

export const IconImage = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M5 17 L10 12.5 L14 16 L16.5 13.5 L19 16" />
  </svg>
);

export const IconAttach = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M20 11 l-8.2 8.2 a4.5 4.5 0 0 1 -6.4 -6.4 l8.2 -8.2 a3 3 0 0 1 4.3 4.3 l-8.2 8.2 a1.5 1.5 0 0 1 -2.2 -2.2 l7.6 -7.6" />
  </svg>
);

export const IconLink = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <path d="M10 13.5 a3.5 3.5 0 0 0 5 0 L18 10.5 a3.5 3.5 0 0 0 -5 -5 L11.5 7" />
    <path d="M14 10.5 a3.5 3.5 0 0 0 -5 0 L6 13.5 a3.5 3.5 0 0 0 5 5 L12.5 17" />
  </svg>
);

export const IconSubpages = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <rect x="4" y="4" width="6" height="4" rx="1" />
    <path d="M7 8 v4 a2 2 0 0 0 2 2 h1 M7 12 h3" />
    <rect x="14" y="10" width="6" height="4" rx="1" />
    <rect x="14" y="16" width="6" height="4" rx="1" />
  </svg>
);

export const IconSection = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M4 9 h16" />
    <path d="M7 13 h8 M7 16 h5" strokeWidth={1.4} />
  </svg>
);

export const IconCallout = ({ size = 17 }: P) => (
  <svg {...svg(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11 v5" />
    <circle cx="12" cy="8" r="0.4" fill="currentColor" />
  </svg>
);
