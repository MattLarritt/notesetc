import { Node, mergeAttributes } from '@tiptap/core';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

export const SECTION_COLORS = ['neutral', 'blue', 'green', 'amber', 'red', 'purple'] as const;
export type SectionColor = (typeof SECTION_COLORS)[number];

function colorFromClass(cls: string): SectionColor {
  return (SECTION_COLORS.find((c) => cls.includes(`nefm-section-${c}`)) ?? 'neutral') as SectionColor;
}

/**
 * A TipTap block node for NEFM sections: a titled, coloured panel that can hold
 * other blocks (callouts included). Editor shows an inline-editable title and a
 * colour picker; round-trips to/from `::::section <color> <title> … ::::`
 * Markdown (four colons so 3-colon callouts nest inside).
 */
export const Section = Node.create({
  name: 'section',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      color: {
        default: 'neutral',
        parseHTML: (el) => colorFromClass((el as HTMLElement).className || ''),
        renderHTML: () => ({}), // class is built in renderHTML below
      },
      title: {
        default: '',
        parseHTML: (el) =>
          (el as HTMLElement).querySelector(':scope > .nefm-section-title')?.textContent?.trim() ?? '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.nefm-section',
        // Content lives in the inner wrapper; the title div is chrome, not content.
        contentElement: (el) =>
          (el as HTMLElement).querySelector(':scope > .nefm-section-content') ?? (el as HTMLElement),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const color = (node.attrs.color as string) || 'neutral';
    const title = (node.attrs.title as string) || '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: `nefm-section nefm-section-${color}` }),
      ...(title ? [['div', { class: 'nefm-section-title' }, title] as const] : []),
      ['div', { class: 'nefm-section-content' }, 0],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      const applyColor = (c: string) => (dom.className = `nefm-section nefm-section-${c}`);
      applyColor(node.attrs.color);

      // Header: editable title + colour picker (both kept out of ProseMirror's content).
      const header = document.createElement('div');
      header.className = 'nefm-section-head';
      header.contentEditable = 'false';

      const title = document.createElement('div');
      title.className = 'nefm-section-title';
      title.contentEditable = 'true';
      title.setAttribute('data-placeholder', 'Section title…');
      if (node.attrs.title) title.textContent = node.attrs.title;

      const setAttr = (patch: Record<string, unknown>) => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }),
        );
      };

      title.addEventListener('blur', () => {
        const val = (title.textContent || '').replace(/\s*\n\s*/g, ' ').trim();
        if (val !== node.attrs.title) setAttr({ title: val });
      });
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); (title as HTMLElement).blur(); }
      });

      const picker = document.createElement('select');
      picker.className = 'nefm-section-color';
      picker.contentEditable = 'false';
      for (const c of SECTION_COLORS) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c[0].toUpperCase() + c.slice(1);
        if (c === node.attrs.color) opt.selected = true;
        picker.appendChild(opt);
      }
      picker.addEventListener('change', () => { applyColor(picker.value); setAttr({ color: picker.value }); });

      header.appendChild(title);
      header.appendChild(picker);

      const contentDOM = document.createElement('div');
      contentDOM.className = 'nefm-section-content';

      dom.appendChild(header);
      dom.appendChild(contentDOM);

      return {
        dom,
        contentDOM,
        update: (updated) => {
          if (updated.type.name !== this.name) return false;
          applyColor(updated.attrs.color);
          if (picker.value !== updated.attrs.color) picker.value = updated.attrs.color;
          if (document.activeElement !== title && (title.textContent || '') !== updated.attrs.title) {
            title.textContent = updated.attrs.title || '';
          }
          return true;
        },
        // Keep ProseMirror out of the header widgets.
        // `Node` is TipTap's node class here, so qualify the DOM one explicitly.
        ignoreMutation: (m) => header.contains(m.target as globalThis.Node),
        stopEvent: (e) => header.contains(e.target as globalThis.Node | null),
      };
    };
  },

  addStorage() {
    const name = this.name;
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; renderContent: (n: unknown) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { color: string; title: string } },
        ) {
          const color = node.attrs.color || 'neutral';
          const title = (node.attrs.title || '').trim();
          // Four colons so nested 3-colon callouts round-trip; colour always
          // written first so it's never confused with a title word on re-parse.
          state.write(`::::section ${color}${title ? ' ' + title : ''}\n`);
          state.renderContent(node);
          state.write('::::');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(container, name, {
              validate: (params: string) => /^section(\s|$)/.test(params.trim()),
              render(tokens: { nesting: number; info: string }[], idx: number) {
                const t = tokens[idx];
                if (t.nesting !== 1) return '</div></div>\n';
                const info = t.info.trim().replace(/^section\s*/, '');
                const first = (info.split(/\s+/)[0] ?? '').toLowerCase();
                const has = (SECTION_COLORS as readonly string[]).includes(first);
                const color = has ? first : 'neutral';
                const title = has ? info.slice(first.length).trim() : info.trim();
                const titleHtml = title
                  ? `<div class="nefm-section-title">${markdownit.utils.escapeHtml(title)}</div>`
                  : '';
                return `<div class="nefm-section nefm-section-${color}">${titleHtml}<div class="nefm-section-content">\n`;
              },
            });
          },
        },
      },
    };
  },
});
