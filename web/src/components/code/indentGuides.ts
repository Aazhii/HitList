import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { indentColumns } from '@/components/code/wrapIndent';

/**
 * The faint vertical rules that mark each level of indentation, as Postman, VS Code and every other editor draw them —
 * they are what let you see which brace a line belongs to without counting spaces.
 *
 * No extra elements: each line gets two numbers (how far apart the rules are, and how far across they run) and the rules
 * themselves are one repeating gradient painted on the line, so a thousand-line file costs a thousand CSS variables and
 * nothing else. Only the lines on screen are measured.
 *
 * A blank line takes the indentation of the line above it, so the rules run through the gaps in a block rather than
 * breaking at every empty line.
 */
function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  // One level of indentation, in columns. CodeEditor sets tabSize from the file's own indent choice, so it answers for
  // spaces and tabs alike.
  const step = state.tabSize;
  const charWidth = view.defaultCharacterWidth;
  for (const { from, to } of view.visibleRanges) {
    let carried = 0;
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      const blank = line.text.trim() === '';
      const columns = blank ? carried : indentColumns(line.text, state.tabSize);
      if (!blank) carried = columns;
      if (columns > 0) {
        builder.add(line.from, line.from, Decoration.line({
          attributes: {
            style: `--cm-guide-step:${(step * charWidth).toFixed(2)}px;--cm-guide-width:${(columns * charWidth).toFixed(2)}px`,
          },
        }));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
