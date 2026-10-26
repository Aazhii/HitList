import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/**
 * When a long line is wrapped, the rest of it lines up under where the line itself begins, instead of starting back at the
 * left margin. It is what VS Code does by default (`editor.wrappingIndent: same`) and what makes a wrapped line still read
 * as one line rather than as two unrelated ones.
 *
 * Done as a hanging indent: the line is pushed right by its own indentation and its first visual row is pulled back by the
 * same amount, so only the continuation rows move. Only the lines on screen are measured, and only while wrapping is on.
 */

/** A line indented further than this keeps its continuation readable rather than squeezed against the right edge. */
const MAX_COLUMNS = 40;

/** How many columns of indentation a line opens with, counting a tab as the distance to the next tab stop. */
export function indentColumns(line: string, tabSize: number): number {
  let columns = 0;
  for (const ch of line) {
    if (ch === ' ') columns += 1;
    else if (ch === '\t') columns += tabSize - (columns % tabSize);
    else break;
  }
  return columns;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { tabSize } = view.state;
  const charWidth = view.defaultCharacterWidth;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const columns = Math.min(MAX_COLUMNS, indentColumns(line.text, tabSize));
      if (columns > 0) {
        builder.add(line.from, line.from, Decoration.line({
          attributes: { style: `--cm-wrap-indent:${Math.round(columns * charWidth)}px` },
        }));
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const wrapIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      // The viewport covers scrolling; geometry covers a resize or a font-size change, both of which move the wrap points.
      if (update.docChanged || update.viewportChanged || update.geometryChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
