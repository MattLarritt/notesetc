import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type MarkdownIt from 'markdown-it';

/**
 * A locked, API-managed region. In stored NEFM it is delimited by line-level
 * sentinels:
 *
 *   [[API-START <id>]]
 *   …managed markdown (rendered normally)…
 *   [[API-END]]
 *
 * The sentinels are NEVER shown — not in the reader (render.ts strips them) and
 * not in the editor (this node hides them behind read-only chrome). The region's
 * content is displayed with the normal editor nodes but cannot be edited or
 * deleted: a ProseMirror transaction filter rejects any change that touches it.
 * Users can still click above or below to add their own content.
 *
 * Escaping: the real sentinels are written unescaped by this node's serializer.
 * If a user *types* "[[API-START …]]", prosemirror-markdown escapes the brackets
 * ("\[\[…"), so the line-anchored parser never treats it as a boundary and it
 * renders as literal text.
 */

// Line is a boundary ONLY when unescaped and alone on the line. The leading `[`
// anchor means an escaped `\[\[…` (what a user's typed text serializes to) can
// never match.
const START_RE = /^\[\[API-START(?:[ \t]+([A-Za-z0-9._:-]+))?\]\][ \t]*$/;
const END_RE = /^\[\[API-END\]\][ \t]*$/;

const PLUGIN_KEY = new PluginKey('apiRegionGuard');

export const ApiRegion = Node.create({
  name: 'apiRegion',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  selectable: true,

  addAttributes() {
    return {
      apiId: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-api-id') || '',
        renderHTML: (attrs) => (attrs.apiId ? { 'data-api-id': attrs.apiId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div.nefm-api-region' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'nefm-api-region' }), 0];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'nefm-api-region';
      if (node.attrs.apiId) dom.setAttribute('data-api-id', node.attrs.apiId);

      const bar = document.createElement('div');
      bar.className = 'nefm-api-region-bar';
      bar.contentEditable = 'false';
      bar.textContent = node.attrs.apiId
        ? `\u{1F512} Managed by “${node.attrs.apiId}” — kept in sync, not editable here`
        : '\u{1F512} Managed content — kept in sync, not editable here';

      const content = document.createElement('div');
      content.className = 'nefm-api-region-content';
      // Belt-and-suspenders: block caret entry. The transaction filter is the
      // authoritative lock (covers paste, programmatic edits, deletion).
      content.contentEditable = 'false';

      dom.appendChild(bar);
      dom.appendChild(content);

      return {
        dom,
        contentDOM: content,
        // The bar is chrome, not document content.
        // `Node` is TipTap's node class here, so qualify the DOM one explicitly.
        ignoreMutation: (m) => bar.contains(m.target as globalThis.Node),
      };
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;

    // The document range a step touches. ReplaceStep/ReplaceAroundStep and
    // AddMark/RemoveMarkStep all expose from/to; AttrStep exposes pos. Relying on
    // step.getMap() alone is WRONG for mark steps — their map is empty (marks don't
    // move positions), which is exactly how a "make bold" edit slipped through.
    const stepRange = (step: unknown): [number, number] | null => {
      const s = step as { from?: number; to?: number; pos?: number };
      if (typeof s.from === 'number' && typeof s.to === 'number') return [s.from, s.to];
      if (typeof s.pos === 'number') return [s.pos, s.pos + 1];
      let lo = Infinity;
      let hi = -Infinity;
      (step as { getMap(): { forEach(f: (a: number, b: number) => void): void } })
        .getMap()
        .forEach((a, b) => {
          lo = Math.min(lo, a);
          hi = Math.max(hi, b);
        });
      return lo === Infinity ? null : [lo, hi];
    };

    return [
      new Plugin({
        key: PLUGIN_KEY,
        filterTransaction(tr, state) {
          if (!tr.docChanged) return true;

          // Ranges (in the pre-transaction doc) occupied by locked regions.
          const ranges: Array<[number, number]> = [];
          state.doc.descendants((n, pos) => {
            if (n.type === type) {
              ranges.push([pos, pos + n.nodeSize]);
              return false; // don't recurse into a locked region
            }
            return true;
          });
          if (ranges.length === 0) return true;

          // Reject any step whose touched range overlaps a locked region. A pure
          // insertion at a region's outer boundary (from === to === regionStart or
          // regionEnd) has zero width there and is allowed, so content can still be
          // added immediately above or below.
          for (const step of tr.steps) {
            const r = stepRange(step);
            if (!r) continue;
            const [sFrom, sTo] = r;
            for (const [from, to] of ranges) {
              if (sFrom < to && sTo > from) return false;
            }
          }

          // Extra guard: the count of locked regions must never drop.
          let before = 0;
          state.doc.descendants((n) => {
            if (n.type === type) before++;
          });
          let after = 0;
          tr.doc.descendants((n) => {
            if (n.type === type) after++;
          });
          return after >= before;
        },

        // Guarantee a normal, editable paragraph exists before and after a region
        // sitting at the very start/end of the document — otherwise there is no
        // place to click to add content above the first (or below the last) region.
        appendTransaction(_transactions, _oldState, newState) {
          const para = newState.schema.nodes.paragraph;
          if (!para) return null;
          const doc = newState.doc;
          const startsLocked = doc.firstChild?.type === type;
          const endsLocked = doc.lastChild?.type === type;
          if (!startsLocked && !endsLocked) return null;

          const tr = newState.tr;
          if (startsLocked) tr.insert(0, para.create());
          if (endsLocked) tr.insert(tr.doc.content.size, para.create());
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (s: string) => void;
            renderContent: (n: unknown) => void;
            closeBlock: (n: unknown) => void;
          },
          node: { attrs: { apiId: string } },
        ) {
          const id = (node.attrs.apiId || '').trim();
          // Written UNescaped — this is a real boundary. User-typed marker text
          // is escaped by the default text serializer, so the two never collide.
          state.write(id ? `[[API-START ${id}]]\n` : '[[API-START]]\n');
          state.renderContent(node);
          state.write('[[API-END]]');
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            md.block.ruler.before(
              'fence',
              'api_region',
              (state: any, startLine: number, endLine: number, silent: boolean) => {
                const begin = state.bMarks[startLine] + state.tShift[startLine];
                const end = state.eMarks[startLine];
                const m = START_RE.exec(state.src.slice(begin, end));
                if (!m) return false;
                if (silent) return true;

                // Find the matching END line.
                let next = startLine + 1;
                let found = false;
                for (; next < endLine; next++) {
                  const b = state.bMarks[next] + state.tShift[next];
                  const e = state.eMarks[next];
                  if (END_RE.test(state.src.slice(b, e))) {
                    found = true;
                    break;
                  }
                }
                if (!found) return false; // no close -> treat as ordinary text

                const oldLineMax = state.lineMax;

                const open = state.push('api_region_open', 'div', 1);
                open.info = m[1] || '';
                open.map = [startLine, next];
                open.block = true;

                state.lineMax = next; // keep inner tokenizer away from the END line
                state.md.block.tokenize(state, startLine + 1, next);
                state.lineMax = oldLineMax;

                const close = state.push('api_region_close', 'div', -1);
                close.block = true;

                state.line = next + 1; // consume through the END line
                return true;
              },
            );

            md.renderer.rules.api_region_open = (tokens: any[], idx: number) => {
              const id = tokens[idx].info
                ? ` data-api-id="${md.utils.escapeHtml(tokens[idx].info)}"`
                : '';
              return `<div class="nefm-api-region"${id}>\n`;
            };
            md.renderer.rules.api_region_close = () => '</div>\n';
          },
        },
      },
    };
  },
});
