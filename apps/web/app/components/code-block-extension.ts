import CodeBlock from '@tiptap/extension-code-block';
import type { Node as PMNode } from '@tiptap/pm/model';
import { HEIGHT_PRESETS, MAX_HEIGHT, MIN_HEIGHT, readHeight, writeHeight } from '../../lib/diagram-meta';

/**
 * StarterKit's code block, plus a header on ```mermaid blocks with the diagram's height.
 *
 * The height is stored as a `%% height: N` line in the diagram source (see
 * lib/diagram-meta), so the picker edits the block's own text: pick Large and the line
 * appears; pick Auto and it goes. Anyone who prefers to type it can — the picker follows.
 * Other code blocks render exactly as before.
 */
export const DiagramCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const lang = (node.attrs.language as string | null) ?? '';
      const dom = document.createElement('div');
      dom.className = 'code-block-wrap';

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (lang) code.className = `${this.options.languageClassPrefix}${lang}`;
      pre.appendChild(code);

      let header: HTMLElement | null = null;
      let sync: (n: PMNode) => void = () => undefined;

      if (lang === 'mermaid') {
        dom.classList.add('is-diagram');
        header = document.createElement('div');
        header.className = 'diagram-edit-head';
        header.contentEditable = 'false';

        const label = document.createElement('span');
        label.className = 'diagram-edit-label';
        label.textContent = 'Diagram';

        const heightLabel = document.createElement('label');
        heightLabel.className = 'diagram-edit-height';
        heightLabel.textContent = 'Height ';

        const select = document.createElement('select');
        for (const p of HEIGHT_PRESETS) {
          const opt = document.createElement('option');
          opt.value = p.px == null ? 'auto' : String(p.px);
          opt.textContent = p.px == null ? p.label : `${p.label} · ${p.px}px`;
          select.appendChild(opt);
        }
        const customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = 'Custom…';
        select.appendChild(customOpt);

        const custom = document.createElement('input');
        custom.type = 'number';
        custom.min = String(MIN_HEIGHT);
        custom.max = String(MAX_HEIGHT);
        custom.step = '10';
        custom.placeholder = 'px';
        custom.className = 'diagram-edit-custom';

        heightLabel.appendChild(select);
        heightLabel.appendChild(custom);
        header.appendChild(label);
        header.appendChild(heightLabel);

        /** Replace the block's text with the same source at a new height. */
        const setHeight = (px: number | null) => {
          if (typeof getPos !== 'function') return;
          const pos = getPos();
          const cur = editor.state.doc.nodeAt(pos);
          if (!cur) return;
          const next = writeHeight(cur.textContent, px);
          if (next === cur.textContent) return;
          const from = pos + 1;
          const to = from + cur.content.size;
          const tr = editor.state.tr;
          if (next) tr.replaceWith(from, to, editor.schema.text(next));
          else tr.delete(from, to);
          editor.view.dispatch(tr);
        };

        sync = (n: PMNode) => {
          const px = readHeight(n.textContent);
          const preset = HEIGHT_PRESETS.find((p) => p.px === px);
          if (preset) {
            select.value = preset.px == null ? 'auto' : String(preset.px);
            custom.hidden = true;
          } else {
            select.value = 'custom';
            custom.hidden = false;
            if (document.activeElement !== custom) custom.value = String(px);
          }
        };
        sync(node);

        select.addEventListener('change', () => {
          if (select.value === 'custom') {
            custom.hidden = false;
            custom.value = String(readHeight(node.textContent) ?? 600);
            custom.focus();
            custom.select();
            setHeight(Number(custom.value));
            return;
          }
          setHeight(select.value === 'auto' ? null : Number(select.value));
        });
        const commitCustom = () => {
          const px = Number(custom.value);
          if (Number.isFinite(px) && px > 0) setHeight(px);
        };
        custom.addEventListener('change', commitCustom);
        custom.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitCustom();
            editor.commands.focus();
          }
        });

        dom.appendChild(header);
      }

      dom.appendChild(pre);

      return {
        dom,
        contentDOM: code,
        update: (updated) => {
          if (updated.type.name !== this.name) return false;
          // Becoming (or ceasing to be) a diagram changes the whole shape: rebuild.
          if (((updated.attrs.language as string | null) ?? '') !== lang) return false;
          node = updated;
          sync(updated);
          return true;
        },
        // The header is ours, not the document's: ProseMirror must neither react to its
        // DOM changes nor swallow the keys and clicks meant for the select and input.
        ignoreMutation: (m) => !!header && header.contains(m.target as globalThis.Node),
        stopEvent: (e) => !!header && header.contains(e.target as globalThis.Node),
      };
    };
  },
});
