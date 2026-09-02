'use client';

import { useEffect, useState } from 'react';

/** Session cache: brand id -> inlineable svg string. */
const svgCache = new Map<string, string>();

export interface AppIconProps {
  /** "ms:<name>" or bare (material font) | "si:<slug>" | "logos:<name>" (brand svg). */
  icon?: string | null;
  className?: string;
  size?: number;
  /** Pre-resolved svg (from search results) to skip the fetch. */
  svg?: string;
}

function isBrandId(icon?: string | null): boolean {
  return !!icon && (icon.startsWith('si:') || icon.startsWith('logos:'));
}

export function AppIcon({ icon, className, size, svg }: AppIconProps) {
  const brand = isBrandId(icon);
  const [markup, setMarkup] = useState<string | null>(() => {
    if (svg) return svg;
    if (icon && svgCache.has(icon)) return svgCache.get(icon)!;
    return null;
  });

  useEffect(() => {
    if (!brand || !icon) return;
    if (svg) {
      svgCache.set(icon, svg);
      setMarkup(svg);
      return;
    }
    if (svgCache.has(icon)) {
      setMarkup(svgCache.get(icon)!);
      return;
    }
    let cancelled = false;
    fetch(`/api/icons/svg?id=${encodeURIComponent(icon)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { svg?: string } | null) => {
        if (!cancelled && d?.svg) {
          svgCache.set(icon, d.svg);
          setMarkup(d.svg);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [icon, brand, svg]);

  if (!brand) {
    const name = icon?.startsWith('ms:') ? icon.slice(3) : icon ?? '';
    return (
      <span
        className={`material-symbols-outlined ${className ?? ''}`}
        style={size ? { fontSize: size } : undefined}
      >
        {name}
      </span>
    );
  }

  const px = size ?? 20;
  return (
    <span
      className={`app-brand ${className ?? ''}`}
      style={{ width: px, height: px, display: 'inline-flex' }}
      // svg comes from our own trusted icon packages (Simple Icons / Iconify logos).
      dangerouslySetInnerHTML={markup ? { __html: markup } : undefined}
    />
  );
}
