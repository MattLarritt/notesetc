import { Node, mergeAttributes } from '@tiptap/core';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

/**
 * Attachment embeds. Three display modes, two nodes:
 *
 * - `attachment` (inline atom) — a file chip or bare icon inside a paragraph.
 *   NEFM: `[name](attachment:<id>)` or `[name](attachment:<id>?icon)`.
 * - `attachmentReader` (block atom) — an embedded document reader.
 *   NEFM: `:::attach <id> <name>` … `:::` (empty body, marker only).
 *
 * The published view turns both into live elements (viewer modal / inline
 * reader) via AttachmentBits; in the editor they render as inert placeholders.
 */

/** Strip characters that would break markdown link syntax round-trips. */
function safeName(name: string): string {
  return (name || 'file').replace(/[[\]()\n]/g, '').trim() || 'file';
}

const ID_RE = /^[a-fA-F0-9-]{10,64}$/;

export function parseAttachmentHref(href: string): { id: string; icon: boolean } | null {
  const m = href.match(/^attachment:([a-fA-F0-9-]{10,64})(\?icon)?$/);
  return m ? { id: m[1], icon: !!m[2] } : null;
}

export const Attachment = Node.create({
  name: 'attachment',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: '' },
      name: { default: 'file' },
      icon: { default: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[href^="attachment:"]',
        priority: 60, // beat the Link mark so these become atoms, not links
        getAttrs: (el) => {
          const a = el as HTMLAnchorElement;
          const parsed = parseAttachmentHref(a.getAttribute('href') ?? '');
          if (!parsed) return false;
          return { id: parsed.id, icon: parsed.icon, name: a.textContent || 'file' };
        },
      },
      {
        tag: 'a[data-attachment-id]',
        priority: 60,
        getAttrs: (el) => {
          const a = el as HTMLAnchorElement;
          const id = a.getAttribute('data-attachment-id') ?? '';
          if (!ID_RE.test(id)) return false;
          return {
            id,
            icon: a.classList.contains('nefm-attachment-icon'),
            name: a.getAttribute('data-attachment-name') || a.textContent || 'file',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = safeName(node.attrs.name as string);
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: `nefm-attachment${node.attrs.icon ? ' nefm-attachment-icon' : ''}`,
        'data-attachment-id': node.attrs.id,
        'data-attachment-name': name,
        title: name,
      }),
      node.attrs.icon ? '📎' : name,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void },
          node: { attrs: { id: string; name: string; icon: boolean } },
        ) {
          const suffix = node.attrs.icon ? '?icon' : '';
          state.write(`[${safeName(node.attrs.name)}](attachment:${node.attrs.id}${suffix})`);
        },
      },
    };
  },
});

export const AttachmentReader = Node.create({
  name: 'attachmentReader',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      id: { default: '' },
      name: { default: 'file' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-attachment-reader]',
        getAttrs: (el) => {
          const d = el as HTMLElement;
          const id = d.getAttribute('data-attachment-id') ?? '';
          if (!ID_RE.test(id)) return false;
          return { id, name: d.getAttribute('data-attachment-name') || 'file' };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = safeName(node.attrs.name as string);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-attachment-reader': '',
        'data-attachment-id': node.attrs.id,
        'data-attachment-name': name,
        class: 'nefm-attachment-reader',
      }),
      ['span', { class: 'nefm-attachment-reader-label' }, `📄 ${name} — embedded reader`],
    ];
  },

  addStorage() {
    const name = this.name;
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { id: string; name: string } },
        ) {
          state.write(`:::attach ${node.attrs.id} ${safeName(node.attrs.name)}\n:::`);
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(container, name, {
              marker: ':',
              validate: (params: string) => /^attach\s+[a-fA-F0-9-]{10,64}(\s|$)/.test(params.trim()),
              render(tokens: { nesting: number; info: string }[], idx: number) {
                const t = tokens[idx];
                if (t.nesting !== 1) return '</div>\n';
                const info = t.info.trim().replace(/^attach\s+/, '');
                const [id, ...rest] = info.split(/\s+/);
                const label = rest.join(' ') || 'file';
                return `<div data-attachment-reader data-attachment-id="${markdownit.utils.escapeHtml(id)}" data-attachment-name="${markdownit.utils.escapeHtml(label)}" class="nefm-attachment-reader">\n`;
              },
            });
          },
        },
      },
    };
  },
});
