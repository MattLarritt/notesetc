import { Node, mergeAttributes } from '@tiptap/core';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

export const CALLOUT_KINDS = ['note', 'info', 'tip', 'warning'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/**
 * A TipTap block node for NEFM callouts. Renders as <div class="callout {kind}">
 * in the editor and round-trips to/from `:::{kind} ... :::` Markdown so the
 * canonical stored form stays plain, AI-friendly Markdown.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (el) => {
          const cls = (el as HTMLElement).className || '';
          return CALLOUT_KINDS.find((k) => cls.includes(k)) ?? 'note';
        },
        renderHTML: (attrs) => ({ class: `callout ${attrs.kind}` }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.callout' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },

  // The toolbar wraps selections via `toggleWrap('callout', { kind })`; no custom
  // command is needed.

  // tiptap-markdown hooks: parse via markdown-it-container, serialize to :::kind.
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; renderContent: (n: unknown) => void; closeBlock: (n: unknown) => void },
          node: { attrs: { kind: string } },
        ) {
          state.write(`:::${node.attrs.kind}\n`);
          state.renderContent(node);
          state.write(':::');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            for (const kind of CALLOUT_KINDS) {
              markdownit.use(container, kind, {
                render(tokens: { nesting: number }[], idx: number) {
                  return tokens[idx].nesting === 1
                    ? `<div class="callout ${kind}">\n`
                    : '</div>\n';
                },
              });
            }
          },
        },
      },
    };
  },
});
