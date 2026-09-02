import 'server-only';
import * as simpleIcons from 'simple-icons';
import logosData from '@iconify-json/logos/icons.json';
import materialNames from './material-names.json';

// --- Material Symbols: full name list (rendered via the self-hosted font) ---

const MATERIAL: string[] = materialNames as string[];

export function searchMaterial(q: string, limit = 80): string[] {
  const query = q.trim().toLowerCase();
  if (!query) return MATERIAL.slice(0, limit);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const n of MATERIAL) {
    if (n.startsWith(query)) starts.push(n);
    else if (n.includes(query)) contains.push(n);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// --- Brand/app logos: Simple Icons (monochrome) + Iconify logos (full-colour) ---

export interface AppIconResult {
  id: string; // "si:<slug>" | "logos:<name>"
  title: string;
  svg: string; // complete, inlineable <svg> (no fixed width/height; viewBox only)
}

// Simple Icons (main export gives title/slug/path/hex).
interface SiIcon {
  title: string;
  slug: string;
  path: string;
  hex: string;
}
// The module namespace carries a `default` export alongside the icons, so it
// does not structurally match Record<string, SiIcon>; the runtime filter below
// is what actually guarantees every retained value is an icon.
const SI: SiIcon[] = Object.values(simpleIcons as unknown as Record<string, SiIcon>).filter(
  (i) => i && typeof i.slug === 'string' && typeof i.path === 'string',
);
const SI_BY_SLUG = new Map(SI.map((i) => [i.slug, i]));

function siSvg(i: SiIcon): string {
  return `<svg viewBox="0 0 24 24" fill="#${i.hex}" xmlns="http://www.w3.org/2000/svg"><path d="${i.path}"/></svg>`;
}

// Iconify logos collection.
const LOGOS = logosData as {
  width?: number;
  height?: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
};
const LOGO_NAMES = Object.keys(LOGOS.icons);

function logoSvg(name: string): string | null {
  const ic = LOGOS.icons[name];
  if (!ic) return null;
  const w = ic.width ?? LOGOS.width ?? 24;
  const h = ic.height ?? LOGOS.height ?? 24;
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${ic.body}</svg>`;
}

/** Search both brand sources; full-colour logos first, then Simple Icons. */
export function searchApps(q: string, limit = 60): AppIconResult[] {
  const query = q.trim().toLowerCase();
  const out: AppIconResult[] = [];

  for (const name of LOGO_NAMES) {
    if (!query || name.includes(query)) {
      const svg = logoSvg(name);
      if (svg) out.push({ id: `logos:${name}`, title: name.replace(/-/g, ' '), svg });
      if (out.length >= limit) return out;
    }
  }
  for (const i of SI) {
    if (!query || i.title.toLowerCase().includes(query) || i.slug.includes(query)) {
      out.push({ id: `si:${i.slug}`, title: i.title, svg: siSvg(i) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Resolve a single stored brand id to an inlineable svg. */
export function getBrandSvg(id: string): string | null {
  if (id.startsWith('si:')) {
    const i = SI_BY_SLUG.get(id.slice(3));
    return i ? siSvg(i) : null;
  }
  if (id.startsWith('logos:')) {
    return logoSvg(id.slice(6));
  }
  return null;
}
