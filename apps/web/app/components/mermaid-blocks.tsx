'use client';

import { useEffect } from 'react';
import { describeDiagram, readHeight } from '../../lib/diagram-meta';

/**
 * Renders ```mermaid fenced code blocks in page content as diagrams, themed to
 * match Notes Etc. Runs client-side: stored Markdown keeps the plain diagram
 * source, so nothing new reaches the server-side sanitizer. mermaid runs with
 * securityLevel 'strict'.
 *
 * Each diagram gets a header (its title or kind, and the controls), a pan/zoom viewport
 * (drag to pan, wheel or buttons to zoom, fit to view), fullscreen, and a Copy Image
 * button that rasterizes the SVG to a PNG on the clipboard. The viewport's height comes
 * from the source's `%% height: N` line when it has one — see lib/diagram-meta.
 */

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
    primaryColor: surface,
    primaryBorderColor: navy,
    primaryTextColor: text,
    secondaryColor: bg,
    secondaryBorderColor: border,
    secondaryTextColor: text,
    tertiaryColor: bg,
    tertiaryBorderColor: border,
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
    noteBkgColor: gold,
    noteTextColor: navy,
    noteBorderColor: amber,
    activationBkgColor: gold,
    actorBkg: surface,
    actorBorder: navy,
    actorTextColor: text,
    signalColor: text,
    signalTextColor: muted,
    fontFamily: v('--font-sans', 'ui-sans-serif, system-ui, sans-serif'),
  };
}

const icon = (paths: string): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', '15');
  el.setAttribute('height', '15');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.9');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.innerHTML = paths;
  return el;
};

/** Rasterize an <svg> to a PNG blob at a given pixel scale. */
async function svgToPng(svg: SVGSVGElement, scale: number): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth || 800;
  const h = vb && vb.height ? vb.height : svg.clientHeight || 600;
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d')!;
  // Match the page surface so transparent diagram areas aren't black.
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() || '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

const ICONS = {
  zoomOut: '<path d="M5 12 h14"/>',
  zoomIn: '<path d="M12 5 v14 M5 12 h14"/>',
  reset: '<path d="M4 9 a8 8 0 1 1 -.5 4"/><path d="M4 5 v4 h4"/>',
  fit: '<path d="M4 9 V4 h5 M20 9 V4 h-5 M4 15 v5 h5 M20 15 v5 h-5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8 V6 a2 2 0 0 0 -2 -2 H6 a2 2 0 0 0 -2 2 v8 a2 2 0 0 0 2 2 h2"/>',
  expand: '<path d="M14 4 h6 v6 M10 20 H4 v-6 M20 4 l-7 7 M4 20 l7 -7"/>',
  collapse: '<path d="M20 10 h-6 V4 M4 14 h6 v6 M14 10 l7 -7 M10 14 l-7 7"/>',
};

/**
 * Build the interactive figure around a freshly rendered SVG string.
 *
 * A header bar names the diagram (its title, or its kind) and carries the controls:
 * zoom, fit, copy as image, and fullscreen. The viewport takes the height the source
 * asks for (`%% height: N`, set from the editor), or sizes to the diagram up to a cap.
 */
function buildFigure(svgMarkup: string, source: string): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'mermaid-figure';

  const head = document.createElement('div');
  head.className = 'mermaid-head';
  const title = document.createElement('span');
  title.className = 'mermaid-title';
  title.textContent = describeDiagram(source);
  const controls = document.createElement('div');
  controls.className = 'mermaid-controls';
  head.appendChild(title);
  head.appendChild(controls);

  const viewport = document.createElement('div');
  viewport.className = 'mermaid-viewport';
  const height = readHeight(source);
  if (height) {
    viewport.style.height = `${height}px`;
    viewport.classList.add('fixed-height');
  }
  const canvas = document.createElement('div');
  canvas.className = 'mermaid-canvas';
  canvas.innerHTML = svgMarkup;
  viewport.appendChild(canvas);

  let scale = 1;
  const apply = () => (canvas.style.transform = `scale(${scale})`);
  const zoom = (factor: number) => {
    scale = Math.min(4, Math.max(0.2, scale * factor));
    apply();
  };
  /** Scale the whole diagram to fit the viewport as it is now — its height and its width. */
  const fit = () => {
    const svg = canvas.querySelector('svg');
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const w = box.width / scale;
    const h = box.height / scale;
    const style = getComputedStyle(viewport);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availW = viewport.clientWidth - padX;
    const availH = viewport.clientHeight - padY;
    if (!w || !h || availW <= 0 || availH <= 0) return;
    scale = Math.min(4, Math.max(0.2, Math.min(availW / w, availH / h)));
    apply();
    viewport.scrollTo(0, 0);
  };

  const btn = (label: string, paths: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mermaid-ctrl-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(icon(paths));
    b.addEventListener('click', onClick);
    return b;
  };
  const setIcon = (b: HTMLButtonElement, label: string, paths: string) => {
    b.title = label;
    b.setAttribute('aria-label', label);
    b.replaceChildren(icon(paths));
  };

  controls.appendChild(btn('Zoom out', ICONS.zoomOut, () => zoom(1 / 1.2)));
  controls.appendChild(btn('Actual size', ICONS.reset, () => { scale = 1; apply(); viewport.scrollTo(0, 0); }));
  controls.appendChild(btn('Zoom in', ICONS.zoomIn, () => zoom(1.2)));
  controls.appendChild(btn('Fit to view', ICONS.fit, fit));

  const copyBtn = btn('Copy as image', ICONS.copy, async () => {
    try {
      const svg = canvas.querySelector('svg') as SVGSVGElement | null;
      if (!svg) return;
      const blob = await svgToPng(svg, 2);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copyBtn.classList.add('done');
      setTimeout(() => copyBtn.classList.remove('done'), 1400);
    } catch {
      copyBtn.classList.add('failed');
      setTimeout(() => copyBtn.classList.remove('failed'), 1400);
    }
  });
  controls.appendChild(copyBtn);

  /*
   * Fullscreen: the browser's own where it has one for elements (desktop browsers,
   * iPad), and an in-page overlay where it does not (iPhone Safari only fullscreens
   * video). Either way the diagram is fitted to the new space on the way in, and put
   * back as it was on the way out.
   */
  const fsBtn = btn('Fullscreen', ICONS.expand, () => void toggleFullscreen());
  controls.appendChild(fsBtn);

  let overlay = false;
  let before = 1;
  const isFull = () => document.fullscreenElement === fig || overlay;
  const entered = () => {
    before = scale;
    setIcon(fsBtn, 'Exit fullscreen', ICONS.collapse);
    requestAnimationFrame(fit);
  };
  const left = () => {
    scale = before;
    apply();
    setIcon(fsBtn, 'Fullscreen', ICONS.expand);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && overlay) closeOverlay();
  };
  const closeOverlay = () => {
    overlay = false;
    fig.classList.remove('is-overlay');
    document.body.classList.remove('mermaid-overlay-open');
    document.removeEventListener('keydown', onKey);
    left();
  };
  async function toggleFullscreen() {
    if (isFull()) {
      if (overlay) closeOverlay();
      else await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (fig.requestFullscreen && document.fullscreenEnabled) {
      try {
        await fig.requestFullscreen();
        return; // fullscreenchange does the rest
      } catch {
        /* refused — fall through to the overlay */
      }
    }
    overlay = true;
    fig.classList.add('is-overlay');
    document.body.classList.add('mermaid-overlay-open');
    document.addEventListener('keydown', onKey);
    entered();
  }
  fig.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === fig) entered();
    else left();
  });

  // Wheel zoom (only when the pointer is over the diagram).
  viewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  // Drag to pan.
  let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
  viewport.addEventListener('pointerdown', (e) => {
    dragging = true;
    sx = e.clientX; sy = e.clientY; sl = viewport.scrollLeft; st = viewport.scrollTop;
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('grabbing');
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    viewport.scrollLeft = sl - (e.clientX - sx);
    viewport.scrollTop = st - (e.clientY - sy);
  });
  const endDrag = () => { dragging = false; viewport.classList.remove('grabbing'); };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  fig.appendChild(head);
  fig.appendChild(viewport);
  return fig;
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
          pre.replaceWith(buildFigure(svg, source));
        } catch {
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
