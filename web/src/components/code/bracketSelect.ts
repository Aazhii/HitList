/**
 * Double-click a bracket ( { [ ( ) ] } ) to select everything between it and its partner (the brackets stay out of it);
 * double-click again to take the brackets too. Brackets inside strings and comments are ignored, because the match follows
 * the language's syntax tree.
 */
import { ensureSyntaxTree, matchBrackets } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Selects between the bracket at `pos` (just after it, or just before it) and its partner. False when there is none. */
export function selectInsideBrackets(view: EditorView, pos: number): boolean {
  const state = view.state;
  // The matching reads the syntax tree; make sure it covers the whole text (it may still be parsing right after a load).
  ensureSyntaxTree(state, state.doc.length, 200);
  // An opening bracket matches forward from its own start, a closing one backward from its end: try the character after the
  // pointer, then the one before it, each both ways.
  const found = matchBrackets(state, pos, 1) ?? matchBrackets(state, pos + 1, -1)
    ?? (pos > 0 ? matchBrackets(state, pos - 1, 1) ?? matchBrackets(state, pos, -1) : null);
  if (!found || !found.matched || !found.end) return false;
  const [open, close] = found.start.from < found.end.from ? [found.start, found.end] : [found.end, found.start];
  const { from, to } = state.selection.main;
  const inside = from === open.to && to === close.from;
  view.dispatch({
    selection: inside ? { anchor: open.from, head: close.to } : { anchor: open.to, head: close.from },
    userEvent: 'select.pointer',
  });
  return true;
}

/** The double-click that does it. A double-click anywhere else keeps selecting a word. */
export const bracketDoubleClick = Prec.high(EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.detail !== 2 || event.button !== 0 || event.shiftKey || event.altKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    if (!selectInsideBrackets(view, pos)) return false;
    event.preventDefault();
    return true;
  },
}));
