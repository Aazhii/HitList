/**
 * Enter right after an opening bracket that has no partner adds the closing one on its own line, with the caret on the
 * indented line between, as IDEs do:  `{|`  then Enter  ->  `{`, `    |`, `}`.
 * When the bracket already has its partner, or the caret is between a pair, the editor's normal Enter does it (it opens the pair
 * up the same way), so this only fills the gap for a bracket whose closer was not typed or was removed.
 */
import { indentUnit, matchBrackets } from '@codemirror/language';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

const CLOSERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

export function enterAfterOpenBracket(view: EditorView): boolean {
  const { state } = view;
  const { main } = state.selection;
  if (state.readOnly || !main.empty) return false;
  const pos = main.head;
  const opener = pos > 0 ? state.sliceDoc(pos - 1, pos) : '';
  const closer = CLOSERS[opener];
  if (!closer) return false;
  const line = state.doc.lineAt(pos);
  if (state.sliceDoc(pos, line.to).trim() !== '') return false;
  const partner = matchBrackets(state, pos - 1, 1);
  if (partner && partner.matched) return false;
  const base = /^[ \t]*/.exec(line.text)![0];
  const unit = state.facet(indentUnit);
  const caret = pos + 1 + base.length + unit.length;
  view.dispatch({
    changes: { from: pos, to: line.to, insert: `\n${base}${unit}\n${base}${closer}` },
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

export const smartEnter: Extension = Prec.high(keymap.of([{ key: 'Enter', run: enterAfterOpenBracket }]));
