import 'server-only';
import MarkdownIt from 'markdown-it';
import container from 'markdown-it-container';
import sanitizeHtml from 'sanitize-html';

/**
 * NEFM (Notes Etc Flavored Markdown) -> safe HTML. Server-only: sanitization runs
 * in trusted Node, and the client only ever receives an allowlisted HTML string.
 *
 * Pipeline (see docs/DESIGN.md §1.5): markdown-it (GFM tables, fenced code,
 * :::callouts) -> HTML -> sanitize-html allowlist. Raw HTML in source is NOT
 * rendered (html:false), matching the "no raw HTML in stored content" rule.
 */
const CALLOUT_KINDS = ['note', 'info', 'tip', 'warning'] as const;

const md = new MarkdownIt({
  html: false, // raw HTML in source is ignored (stored content is HTML-free)
  linkify: true,
  breaks: false,
});

for (const kind of CALLOUT_KINDS) {
  md.use(container, kind, {
    render(tokens: { nesting: number }[], idx: number): string {
      return tokens[idx].nesting === 1 ? `<div class="callout ${kind}">\n` : '</div>\n';
    },
  });
}

// `:::subpages` -> an empty marker div; the page view expands it into the live
// child-page tree at exactly this spot.
md.use(container, 'subpages', {
  render(tokens: { nesting: number }[], idx: number): string {
    return tokens[idx].nesting === 1 ? '<div class="nefm-subpages"></div>\n' : '';
  },
});

// `::::section <color> <title>` -> a titled, coloured panel (shaded body + left
// accent bar + heading). Written with FOUR colons so 3-colon callouts nest inside
// it. Colour is optional (defaults to neutral) and constrained to the palette so
// only allow-listed CSS classes ever reach the sanitizer.
export const SECTION_COLORS = ['neutral', 'blue', 'green', 'amber', 'red', 'purple'] as const;
md.use(container, 'section', {
  validate: (params: string) => /^section(\s|$)/.test(params.trim()),
  render(tokens: { nesting: number; info: string }[], idx: number): string {
    const t = tokens[idx];
    if (t.nesting !== 1) return '</div>\n';
    const info = t.info.trim().replace(/^section\s*/, '');
    const first = (info.split(/\s+/)[0] ?? '').toLowerCase();
    const hasColor = (SECTION_COLORS as readonly string[]).includes(first);
    const color = hasColor ? first : 'neutral';
    const title = hasColor ? info.slice(first.length).trim() : info.trim();
    const titleHtml = title
      ? `<div class="nefm-section-title">${md.utils.escapeHtml(title)}</div>`
      : '';
    return `<div class="nefm-section nefm-section-${color}">${titleHtml}\n`;
  },
});

// `:::attach <id> <name>` -> an embedded document reader. The div is a marker;
// AttachmentBits (client) hydrates it into a live inline viewer.
md.use(container, 'attach', {
  validate: (params: string) => /^attach\s+[a-fA-F0-9-]{10,64}(\s|$)/.test(params.trim()),
  render(tokens: { nesting: number; info: string }[], idx: number): string {
    const t = tokens[idx];
    if (t.nesting !== 1) return '</div>\n';
    const info = t.info.trim().replace(/^attach\s+/, '');
    const [id, ...rest] = info.split(/\s+/);
    const label = rest.join(' ') || 'file';
    return `<div class="nefm-attachment-reader" data-attachment-id="${md.utils.escapeHtml(id)}" data-attachment-name="${md.utils.escapeHtml(label)}">\n`;
  },
});

// `[label](attachment:<id>)` / `[label](attachment:<id>?icon)` -> a file chip /
// bare icon that opens the viewer. Rewritten at render time to the real serve
// URL; clicks are intercepted client-side by AttachmentBits.
const ATTACHMENT_HREF = /^attachment:([a-fA-F0-9-]{10,64})(\?icon)?$/;
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
const defaultLinkClose =
  md.renderer.rules.link_close ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') ?? '';
  const m = href.match(ATTACHMENT_HREF);
  if (!m) return defaultLinkOpen(tokens, idx, options, env, self);
  const [, id, icon] = m;
  tokens[idx].attrSet('href', `/api/bff/attachments/${id}`);
  tokens[idx].attrSet('class', `nefm-attachment${icon ? ' nefm-attachment-icon' : ''}`);
  tokens[idx].attrSet('data-attachment-id', id);
  (env as Record<string, unknown>)._netcAttachmentIcon = !!icon;
  // Icon mode keeps the label for screen readers but hides it visually.
  return self.renderToken(tokens, idx, options) + (icon ? '📎<span class="nefm-attachment-label">' : '');
};
md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
  const e = env as Record<string, unknown>;
  if (e._netcAttachmentIcon) {
    e._netcAttachmentIcon = false;
    return '</span>' + self.renderToken(tokens, idx, options);
  }
  return defaultLinkClose(tokens, idx, options, env, self);
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'a', 'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'pre', 'code', 'strong', 'em', 'del', 's', 'hr', 'br',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span', 'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target', 'class', 'data-attachment-id'],
    code: ['class'], // language-xxx from fenced blocks
    div: ['class', 'data-attachment-id', 'data-attachment-name'],
    span: ['class'],
    th: ['align'],
    td: ['align'],
    ol: ['start'],
    img: ['src', 'alt', 'title'],
  },
  // Images: allow our own auth-gated attachment route (relative) and http(s).
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  allowedClasses: {
    a: ['nefm-attachment', 'nefm-attachment-icon'],
    span: ['nefm-attachment-label'],
    div: [
      'callout',
      ...CALLOUT_KINDS,
      'nefm-subpages',
      'nefm-section',
      'nefm-section-title',
      'nefm-attachment-reader',
      ...SECTION_COLORS.map((c) => `nefm-section-${c}`),
    ],
    code: [/^language-[a-z0-9-]+$/],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Harden links: no window.opener access, hint untrusted.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
  },
};

// Line-level markers that delimit an API-managed region:
//   [[API-START <id>]] … [[API-END]]
// They must never be visible. Only UNescaped markers alone on a line are removed;
// a user-typed marker is escaped to `\[\[…` by the editor and stays literal (the
// leading `[` anchor here won't match `\[`).
const API_MARKER_LINE = /^[ \t]*\[\[API-(?:START(?:[ \t]+[A-Za-z0-9._:-]+)?|END)\]\][ \t]*$/gm;

/**
 * Strip hidden managed-content markers so they never render, but only OUTSIDE
 * fenced code blocks — so documentation that shows a literal marker in a code
 * sample is preserved.
 *
 * Two kinds: legacy HTML comments (`<!-- … -->`, which `html: false` would
 * otherwise escape into visible text) and the newer `[[API-START]]/[[API-END]]`
 * region sentinels. The inner content stays and renders normally.
 */
function stripHiddenMarkers(markdown: string): string {
  // Split on fenced code blocks (``` or ~~~); keep those segments verbatim.
  const parts = markdown.split(/(^ {0,3}(?:```|~~~)[\s\S]*?^ {0,3}(?:```|~~~)[^\n]*$)/m);
  return parts
    .map((seg) =>
      /^ {0,3}(?:```|~~~)/.test(seg)
        ? seg
        : seg.replace(/<!--[\s\S]*?-->/g, '').replace(API_MARKER_LINE, ''),
    )
    .join('');
}

export function renderHfmToSafeHtml(markdown: string): string {
  const rawHtml = md.render(stripHiddenMarkers(markdown ?? ''));
  return sanitizeHtml(rawHtml, SANITIZE_OPTIONS);
}
