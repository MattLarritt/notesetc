import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Keep an empty paragraph at the end of the document. Without it, a page
 * ending in a section, callout, table or reader block leaves the cursor
 * nowhere to go — you can't click below the last panel to keep typing.
 * The empty trailing paragraph serializes to nothing, so round-trips clean.
 */
export const TrailingNode = Extension.create({
  name: 'trailingNode',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingNode'),
        appendTransaction: (_transactions, _oldState, newState) => {
          const { doc, tr, schema } = newState;
          const last = doc.lastChild;
          if (!last || last.type.name === 'paragraph') return undefined;
          return tr.insert(doc.content.size, schema.nodes.paragraph.create());
        },
      }),
    ];
  },
});
