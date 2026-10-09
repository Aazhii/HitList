/**
 * How the code editor looks. Every colour is a `--code-*` variable (index.css), so it follows light and dark and
 * the components carry no raw colours.
 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export const codeTheme = EditorView.theme({
  '&': {
    color: 'var(--code-fg)',
    backgroundColor: 'var(--code-bg)',
    fontSize: 'var(--code-size, 13px)',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: MONO, lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--code-cursor)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-cursor)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--code-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--code-bg)',
    color: 'var(--code-gutter)',
    border: 'none',
    borderRight: '1px solid var(--a-line)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-active-line)', color: 'var(--code-fg)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '34px' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--code-active-line)', border: 'none', color: 'var(--code-gutter)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--code-selection)',
    outline: '1px solid var(--code-gutter)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--code-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--code-match)', outline: '1px solid var(--code-gutter)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--code-selection)' },
  '.cm-panels': { backgroundColor: 'var(--a-surface-2)', color: 'var(--a-ink)', borderColor: 'var(--a-line)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--a-line)' },
  '.cm-panel.cm-search': { padding: '8px 10px', fontSize: '12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontSize: '12px' },
  '.cm-panel.cm-search input': {
    backgroundColor: 'var(--a-surface)', color: 'var(--a-ink)', border: '1px solid var(--a-line)', borderRadius: '6px', padding: '3px 6px',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: 'var(--a-surface)', color: 'var(--a-ink)', border: '1px solid var(--a-line)', borderRadius: '6px', padding: '3px 8px', backgroundImage: 'none',
  },
  '.cm-tooltip': { backgroundColor: 'var(--a-surface)', color: 'var(--a-ink)', border: '1px solid var(--a-line)', borderRadius: '8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--code-selection)', color: 'var(--code-fg)' },
});

export const codeHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.integer, t.float], color: 'var(--code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.macroName], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--code-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--code-tag)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.meta], color: 'var(--code-punct)' },
  { tag: [t.heading], color: 'var(--code-keyword)', fontWeight: '600' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--code-number)', textDecoration: 'underline' },
  { tag: [t.invalid], color: 'var(--code-invalid)' },
]);
