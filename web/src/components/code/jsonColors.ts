/**
 * Colours for JSON that do not depend on the text being valid. The parser's own colouring guesses when something is wrong
 * (a key inside an array, a missing brace) and then paints the same kind of token in different colours from line to line.
 * This marks by shape instead: a string followed by a colon is a key, any other string is a value, plus numbers and
 * true/false/null. The marks win over the parser's (see codeTheme), so a half-typed file reads the same all the way down.
 *
 * Comments are marked here too. The JSON parser knows nothing about them (they are a JSONC thing, which ⌘/ writes), so
 * without this they would read as ordinary text; Postman greys them out and so do we.
 */
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { type Extension } from '@codemirror/state';

const key = Decoration.mark({ class: 'cm-json-key' });
const value = Decoration.mark({ class: 'cm-json-value' });
const comment = Decoration.mark({ class: 'cm-json-comment' });

// A string comes first in the alternation and so wins from its opening quote, which is what keeps a // or /* inside a
// string ("http://x") text rather than the start of a comment.
const matcher = new MatchDecorator({
  regexp: /"(?:[^"\\\n]|\\.)*"|\/\/[^\n]*|\/\*(?:[^*]|\*(?!\/))*\*\/|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b/g,
  decoration: (match, view, pos) => {
    if (match[0][0] === '/') return comment;
    if (match[0][0] !== '"') return value;
    const after = pos + match[0].length;
    return /^[ \t]*:/.test(view.state.sliceDoc(after, Math.min(view.state.doc.length, after + 40))) ? key : value;
  },
});

const plugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = matcher.createDeco(view); }
  update(update: ViewUpdate) { this.decorations = matcher.updateDeco(update, this.decorations); }
}, { decorations: (instance) => instance.decorations });

export const jsonColors: Extension = plugin;
