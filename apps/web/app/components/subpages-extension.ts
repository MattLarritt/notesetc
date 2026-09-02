import { Node, mergeAttributes } from '@tiptap/core';
import container from 'markdown-it-container';
import type MarkdownIt from 'markdown-it';

/**
 * An optional block the author drops anywhere in a page. It has no content of its
 * own — on the published page it expands into a live list of that page's child
 * pages. Round-trips to/from a `:::subpages` Markdown container so the stored form
 * stays plain, AI-friendly Markdown.
 */
export const Subpages = Node.create({
  name: 'subpages',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-subpages]' }];
  },

  renderHTML() {
    // Editor placeholder (the real list is rendered at view time).
    return [
      'div',
      mergeAttributes({ 'data-subpages': '', class: 'subpages-embed' }),
      '📄  Subpages — the child pages of this page will be listed here',
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (n: unknown) => void },
          node: unknown,
        ) {
          state.write(':::subpages\n:::');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(container, 'subpages', {
              render(tokens: { nesting: number }[], idx: number) {
                return tokens[idx].nesting === 1 ? '<div data-subpages></div>\n' : '';
              },
            });
          },
        },
      },
    };
  },
});
