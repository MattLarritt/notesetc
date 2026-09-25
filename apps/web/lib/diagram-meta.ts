/**
 * What a ```mermaid block says about how it should be shown, as opposed to what it draws.
 *
 * The height lives IN the diagram source, as a Mermaid comment on its own line:
 *
 *     %% height: 600
 *
 * Mermaid ignores `%%` lines, so the diagram still renders anywhere Mermaid does. And
 * because it is part of the code block's text, it survives everything a page goes
 * through — the editor, the Markdown it is stored as, the server-side sanitizer —
 * without a new attribute, a new NEFM construct, or a schema change. The editor's
 * height picker reads and writes this line; the page view reads it.
 */

/** Heights the editor offers by name. Anything else is a custom value. */
export const HEIGHT_PRESETS: { label: string; px: number | null }[] = [
  { label: 'Auto', px: null },
  { label: 'Small', px: 320 },
  { label: 'Medium', px: 480 },
  { label: 'Large', px: 720 },
  { label: 'Extra large', px: 1000 },
];

export const MIN_HEIGHT = 150;
export const MAX_HEIGHT = 3000;

const HEIGHT_LINE = /^[ \t]*%%[ \t]*height[ \t]*:[ \t]*(\d{1,5})[ \t]*(?:px)?[ \t]*$/im;
const HEIGHT_LINES = /^[ \t]*%%[ \t]*height[ \t]*:.*(?:\r?\n|$)/gim;

export function clampHeight(px: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(px)));
}

/** The height the source asks for, in px, or null for Auto. */
export function readHeight(source: string): number | null {
  const m = source.match(HEIGHT_LINE);
  if (!m) return null;
  const px = Number(m[1]);
  return Number.isFinite(px) && px > 0 ? clampHeight(px) : null;
}

/**
 * The source with its height set (or removed, for null). The line goes first, where a
 * reader of the source sees it, and any earlier height lines are replaced, never stacked.
 */
export function writeHeight(source: string, px: number | null): string {
  const body = source.replace(HEIGHT_LINES, '');
  return px == null ? body : `%% height: ${clampHeight(px)}\n${body}`;
}

const KINDS: [RegExp, string][] = [
  [/^(flowchart|graph)\b/, 'Flowchart'],
  [/^sequenceDiagram\b/, 'Sequence diagram'],
  [/^classDiagram\b/, 'Class diagram'],
  [/^stateDiagram\b/, 'State diagram'],
  [/^erDiagram\b/, 'Entity relationship diagram'],
  [/^gantt\b/, 'Gantt chart'],
  [/^pie\b/, 'Pie chart'],
  [/^journey\b/, 'User journey'],
  [/^gitGraph\b/, 'Git graph'],
  [/^mindmap\b/, 'Mind map'],
  [/^timeline\b/, 'Timeline'],
  [/^quadrantChart\b/, 'Quadrant chart'],
  [/^xychart/, 'Chart'],
  [/^sankey/, 'Sankey diagram'],
  [/^block/, 'Block diagram'],
  [/^architecture/, 'Architecture diagram'],
  [/^requirementDiagram\b/, 'Requirement diagram'],
  [/^C4/, 'C4 diagram'],
  [/^kanban\b/, 'Kanban board'],
  [/^packet/, 'Packet diagram'],
  [/^radar/, 'Radar chart'],
];

/**
 * A name for the diagram's header: its own `title:` (front matter, or the title line
 * several diagram types take), otherwise what kind of diagram it is.
 */
export function describeDiagram(source: string): string {
  const front = source.match(/^\s*---\s*\n([\s\S]*?)\n\s*---/);
  const frontTitle = front?.[1].match(/^\s*title\s*:\s*(.+)$/m)?.[1];
  if (frontTitle) return unquote(frontTitle);

  const lines = source
    .replace(/^\s*---\s*\n[\s\S]*?\n\s*---/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));
  const inlineTitle = lines.find((l) => /^title\s+\S/.test(l));
  if (inlineTitle) return unquote(inlineTitle.replace(/^title\s+/, ''));

  const first = lines[0] ?? '';
  return KINDS.find(([re]) => re.test(first))?.[1] ?? 'Diagram';
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '');
}
