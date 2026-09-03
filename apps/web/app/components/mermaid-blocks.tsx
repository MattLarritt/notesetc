'use client';

import { useEffect } from 'react';

/**
 * Renders ```mermaid fenced code blocks in page content as diagrams, themed to
 * match Notes Etc (navy ink, gold/amber accents, warm surfaces). Runs entirely
 * client-side: the stored Markdown keeps the plain diagram source, so nothing
 * new reaches the server-side sanitizer. mermaid runs with securityLevel
 * 'strict', which sandboxes labels and blocks scripts/HTML in diagram text.
 */

// Pull live theme values so the diagram tracks the CSS palette exactly.
function themeVars(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const navy = v('--brand-navy', '#3e4259');
  const gold = v('--brand-gold', '#f2c200');
  const amber = v('--brand-amber', '#d97b0e');
  const surface = v('--color-surface', '#ffffff');
  const border = v('--color-border', '#ece3cf');
  const text = v('--color-text', '#3e4259');
  const muted = v('--color-text-muted', '#6b7280');
  const bg = v('--color-bg', '#fffdf7');
  return {
    // Nodes: warm surface with a navy outline; primary accents in gold.
    primaryColor: surface,
    primaryBorderColor: navy,
    primaryTextColor: text,
    secondaryColor: bg,
    secondaryBorderColor: border,
    secondaryTextColor: text,
    tertiaryColor: bg,
    tertiaryBorderColor: border,
    // Lines and labels.
    lineColor: amber,
    textColor: text,
    mainBkg: surface,
    nodeBorder: navy,
    clusterBkg: bg,
    clusterBorder: border,
    titleColor: navy,
    edgeLabelBackground: surface,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    // Notes / accents pick up the brand gold.
    noteBkgColor: gold,
    noteTextColor: navy,
    noteBorderColor: amber,
    activationBkgColor: gold,
    // Sequence / flow specifics.
    actorBkg: surface,
    actorBorder: navy,
    actorTextColor: text,
    signalColor: text,
    signalTextColor: muted,
    fontFamily: v('--font-sans', 'ui-sans-serif, system-ui, sans-serif'),
  };
}

export function MermaidBlocks() {
  useEffect(() => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
    ).filter((el) => !el.dataset.netcMermaid);
    if (!blocks.length) return;

    let cancelled = false;
    void (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: themeVars(),
      });
      for (let i = 0; i < blocks.length; i++) {
        if (cancelled) return;
        const code = blocks[i];
        const source = code.textContent ?? '';
        code.dataset.netcMermaid = '1';
        const pre = code.parentElement as HTMLElement;
        try {
          const { svg } = await mermaid.render(`netc-mermaid-${Date.now()}-${i}`, source);
          const fig = document.createElement('figure');
          fig.className = 'mermaid-figure';
          fig.innerHTML = svg;
          pre.replaceWith(fig);
        } catch {
          // Invalid diagram: leave the code block, flag it so it isn't retried.
          pre.classList.add('mermaid-error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  return null;
}
