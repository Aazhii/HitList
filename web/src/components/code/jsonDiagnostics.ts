/**
 * Warnings for JSON as it is typed: a wavy underline where the first problem is (hover shows why) and a bar along the bottom
 * saying what and on which line; clicking the bar goes there. Built on lib/jsonLint, so it needs no extra package.
 */
import { StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, showPanel } from '@codemirror/view';
import { lintJson, type JsonProblem } from '@/lib/jsonLint';

const problemOf = (text: string): JsonProblem | null => lintJson(text)[0] ?? null;

const problemField = StateField.define<JsonProblem | null>({
  create: (state) => problemOf(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? problemOf(tr.newDoc.toString()) : value),
});

const underline = EditorView.decorations.compute([problemField], (state) => {
  const problem = state.field(problemField);
  if (!problem) return Decoration.none;
  return Decoration.set([Decoration.mark({ class: 'cm-json-error', attributes: { title: problem.message } }).range(problem.from, problem.to)]);
});

const bar = showPanel.compute([problemField], (state) => {
  const problem = state.field(problemField);
  if (!problem) return null;
  const line = state.doc.lineAt(problem.from).number;
  return (view) => {
    const dom = document.createElement('div');
    dom.className = 'cm-json-problem';
    dom.setAttribute('role', 'alert');
    dom.title = 'Go to the problem';
    dom.textContent = `Line ${line}: ${problem.message}`;
    dom.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: problem.from }, scrollIntoView: true });
      view.focus();
    });
    return { dom, bottom: true };
  };
});

export const jsonDiagnostics: Extension = [problemField, underline, bar];
