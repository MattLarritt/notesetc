'use client';

import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';

const VAR_RE = /netc\.variable\(\s*['"`]([^'"`]*)['"`]\s*\)/g;

/**
 * CodeMirror 6 wrapper for automation scripts. Uncontrolled: the parent passes
 * the initial doc and receives changes via onChange. `netc.variable('x')`
 * references are highlighted — RED when x is a secure variable (so secrets in
 * use are visually obvious), amber otherwise.
 */
export interface CodeEditorApi {
  /** Insert text at the cursor (replacing any selection) and focus the editor. */
  insert: (text: string) => void;
}

export function CodeEditor({
  initialValue,
  onChange,
  secureNames = [],
  height = '380px',
  apiRef,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  /** Names of secure variables (for red highlighting of references). */
  secureNames?: string[];
  height?: string;
  /** Receives an imperative handle (e.g. for the variable picker to insert code). */
  apiRef?: React.MutableRefObject<CodeEditorApi | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const secureRef = useRef<Set<string>>(new Set(secureNames));
  secureRef.current = new Set(secureNames);

  useEffect(() => {
    if (!hostRef.current) return;

    // Rebuilds on every update (docs are small); reads the live secure-name set
    // via ref so late-loading variable lists still colour correctly.
    const buildDecorations = (view: EditorView): DecorationSet => {
      const found: { from: number; to: number; secure: boolean }[] = [];
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        for (const m of text.matchAll(VAR_RE)) {
          found.push({
            from: from + (m.index ?? 0),
            to: from + (m.index ?? 0) + m[0].length,
            secure: secureRef.current.has(m[1]),
          });
        }
      }
      return Decoration.set(
        found.map((f) =>
          Decoration.mark({ class: f.secure ? 'cm-netc-var-secure' : 'cm-netc-var' }).range(f.from, f.to),
        ),
      );
    };

    const varHighlighter = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view);
        }
        update(u: ViewUpdate) {
          this.decorations = buildDecorations(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    );

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          basicSetup,
          javascript(),
          varHighlighter,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height, fontSize: '13px', border: '1px solid var(--color-border)', borderRadius: '8px', background: '#fffdf7' },
            '.cm-scroller': { fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace', overflow: 'auto' },
            '&.cm-focused': { outline: '2px solid var(--color-primary, #f2c200)' },
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    if (apiRef) {
      apiRef.current = {
        insert: (text: string) => {
          view.dispatch(view.state.replaceSelection(text));
          view.focus();
        },
      };
    }
    return () => {
      if (apiRef) apiRef.current = null;
      view.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once; the editor owns the doc afterwards

  // Repaint highlights when the secure-name list arrives/changes.
  useEffect(() => {
    viewRef.current?.dispatch({});
  }, [secureNames]);

  return <div ref={hostRef} />;
}
