import { useEffect, useRef } from 'react';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import {
  EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { cn } from '@/lib/utils';
import { indentString, languageById, type IndentChoice } from '@/lib/codeLanguages';
import { codeHighlight, codeTheme } from '@/components/code/codeTheme';

/** Marks a change that came from the `value` prop, so it is not reported back as an edit. */
const fromProp = Annotation.define<boolean>();

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** A `codeLanguages` id; plain text when missing or unknown. */
  language?: string;
  indent?: IndentChoice;
  wrap?: boolean;
  fontSize?: number;
  readOnly?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Where the caret is, for a status line. */
  onCursor?: (position: { line: number; column: number; selected: number }) => void;
  className?: string;
}

/**
 * The code editor: CodeMirror 6 with what an IDE gives — language colours, indentation that follows the language,
 * Tab / Shift+Tab, bracket and quote pairing, line numbers, folding, multiple cursors, move/duplicate line,
 * find and replace (⌘F inside it). It owns the keys while it has focus.
 *
 * The text is the `value` prop: typing reports through `onChange`; changing `value` from outside replaces the text.
 */
export function CodeEditor({
  value, onChange, language, indent = '2', wrap = false, fontSize = 13, readOnly = false, ariaLabel = 'Code',
  autoFocus = false, onCursor, className,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const parts = useRef({ language: new Compartment(), indent: new Compartment(), wrap: new Compartment(), readOnly: new Compartment() });
  // The latest callbacks, read by the editor's long-lived listener.
  const callbacks = useRef({ onChange, onCursor });
  useEffect(() => { callbacks.current = { onChange, onCursor }; });

  const indentExtension = (choice: IndentChoice) => [indentUnit.of(indentString(choice)), EditorState.tabSize.of(choice === 'tab' ? 4 : Number(choice))];

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), dropCursor(),
          EditorState.allowMultipleSelections.of(true), indentOnInput(), syntaxHighlighting(codeHighlight), bracketMatching(),
          closeBrackets(), autocompletion(), rectangularSelection(), crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
          search({ top: true }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
          codeTheme,
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
          parts.current.language.of([]),
          parts.current.indent.of(indentExtension(indent)),
          parts.current.wrap.of(wrap ? EditorView.lineWrapping : []),
          parts.current.readOnly.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromProp))) {
              callbacks.current.onChange?.(update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main;
              const line = update.state.doc.lineAt(head.head);
              callbacks.current.onCursor?.({ line: line.number, column: head.head - line.from + 1, selected: Math.abs(head.to - head.from) });
            }
          }),
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => { editor.destroy(); view.current = null; };
    // The editor is created once; every prop below is applied by its own effect.
  }, []);

  // New text from outside (another file chosen, an undo elsewhere); typing is not echoed back.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: fromProp.of(true) });
  }, [value]);

  // The language loads on demand; until it arrives the text shows plain, and a failure leaves it plain.
  useEffect(() => {
    let live = true;
    languageById(language).load()
      .then((extension) => { if (live) view.current?.dispatch({ effects: parts.current.language.reconfigure(extension) }); })
      .catch(() => { if (live) view.current?.dispatch({ effects: parts.current.language.reconfigure([]) }); });
    return () => { live = false; };
  }, [language]);

  useEffect(() => { view.current?.dispatch({ effects: parts.current.indent.reconfigure(indentExtension(indent)) }); }, [indent]);
  useEffect(() => { view.current?.dispatch({ effects: parts.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.readOnly.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  return <div ref={host} data-code-editor className={cn('h-full min-h-0 overflow-hidden', className)} style={{ ['--code-size' as string]: `${fontSize}px` }} />;
}
