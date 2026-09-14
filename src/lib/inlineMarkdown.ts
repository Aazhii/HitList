/**
 * Inline formatting for note blocks: bold, italic, underline, strikethrough.
 *
 * Marks are stored as delimiters inside a block's existing `content` string.
 * That choice is what keeps this safe to ship: `content` stays a plain string,
 * so every note already saved is valid as-is, the server (which stores blocks
 * as opaque JSON) needs no change, and there is no migration.
 *
 *   **bold**   *italic*   ++underline++   ~~strike~~
 *
 * Italic is `*`, not `_`, because `_` appears inside ordinary words
 * (`snake_case`). Underline is `++` because Markdown has no underline and the
 * obvious `__x__` collides with names like `__init__`.
 *
 * Everything here is pure. The editor renders the parsed runs while a block is
 * not focused, and shows the raw text in its textarea while it is — so the
 * textarea's keyboard behaviour is untouched by any of this.
 */

export type Mark = 'bold' | 'italic' | 'underline' | 'strike';

export const MARKS: readonly Mark[] = ['bold', 'italic', 'underline', 'strike'];

export const MARK_DELIMITER: Record<Mark, string> = {
  bold: '**',
  italic: '*',
  underline: '++',
  strike: '~~',
};

/** A run of rendered text that carries one set of marks. */
export interface InlineRun {
  text: string;
  /** In MARKS order, so rendering nests consistently. */
  marks: Mark[];
  /** src[i] is the index in the source string of text[i]. */
  src: number[];
}

/** A matched opening and closing delimiter, as source offsets. */
export interface MarkPair {
  mark: Mark;
  openStart: number;
  contentStart: number;
  contentEnd: number;
  closeEnd: number;
}

// ── Lexing ────────────────────────────────────────────────────────────────────

interface Delim {
  mark: Mark;
  start: number;
  len: number;
  canOpen: boolean;
  canClose: boolean;
}

type Piece =
  | { kind: 'char'; ch: string; src: number }
  | { kind: 'delim'; d: Delim; role: 'open' | 'close' | null };

const ESCAPABLE = new Set(['*', '~', '+', '\\']);

function isSpace(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c);
}

/**
 * Splits the source into characters and delimiter candidates.
 *
 * A delimiter may open only when the next character is not whitespace, and
 * close only when the previous one is not. That flanking rule is what leaves
 * `2 * 3 * 4` and `C++ and C++` as literal text.
 */
function lex(text: string): Piece[] {
  const pieces: Piece[] = [];
  let i = 0;

  const pushDelim = (mark: Mark, start: number, len: number, prev: string | undefined, next: string | undefined) => {
    pieces.push({
      kind: 'delim',
      d: { mark, start, len, canOpen: !isSpace(next), canClose: !isSpace(prev) },
      role: null,
    });
  };

  while (i < text.length) {
    const c = text[i];

    if (c === '\\' && ESCAPABLE.has(text[i + 1])) {
      pieces.push({ kind: 'char', ch: text[i + 1], src: i + 1 });
      i += 2;
      continue;
    }

    if (c === '*') {
      let n = 0;
      while (text[i + n] === '*') n++;
      const prev = text[i - 1];
      const next = text[i + n];

      if (n === 3) {
        // `***x***` is bold + italic. At an opening position emit ** then *, at a
        // closing one * then **, so closers mirror openers and both pairs match.
        const closing = !isSpace(prev) && isSpace(next);
        if (closing) {
          pushDelim('italic', i, 1, prev, next);
          pushDelim('bold', i + 1, 2, prev, next);
        } else {
          pushDelim('bold', i, 2, prev, next);
          pushDelim('italic', i + 2, 1, prev, next);
        }
      } else {
        let k = 0;
        for (; k + 1 < n; k += 2) pushDelim('bold', i + k, 2, prev, next);
        if (k < n) pushDelim('italic', i + k, 1, prev, next);
      }
      i += n;
      continue;
    }

    if ((c === '~' || c === '+') && text[i + 1] === c) {
      pushDelim(c === '~' ? 'strike' : 'underline', i, 2, text[i - 1], text[i + 2]);
      i += 2;
      continue;
    }

    pieces.push({ kind: 'char', ch: c, src: i });
    i++;
  }

  return pieces;
}

// ── Matching ──────────────────────────────────────────────────────────────────

function match(text: string): { pieces: Piece[]; pairs: MarkPair[] } {
  const pieces = lex(text);
  const pairs: MarkPair[] = [];
  const stack: number[] = [];

  pieces.forEach((piece, idx) => {
    if (piece.kind !== 'delim') return;
    const d = piece.d;

    if (d.canClose) {
      for (let s = stack.length - 1; s >= 0; s--) {
        const opener = pieces[stack[s]] as Extract<Piece, { kind: 'delim' }>;
        if (opener.d.mark !== d.mark) continue;
        // Nothing between the delimiters: `****` is not an empty bold.
        if (opener.d.start + opener.d.len === d.start) break;

        opener.role = 'open';
        piece.role = 'close';
        pairs.push({
          mark: d.mark,
          openStart: opener.d.start,
          contentStart: opener.d.start + opener.d.len,
          contentEnd: d.start,
          closeEnd: d.start + d.len,
        });
        // Openers above the one just closed can no longer close properly, so they
        // stay literal — `**a *b** c*` bolds "a *b" and leaves the stars as text.
        stack.length = s;
        return;
      }
    }

    if (d.canOpen) stack.push(idx);
  });

  return { pieces, pairs };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Every matched delimiter pair in `text`, in the order they close. */
export function findPairs(text: string): MarkPair[] {
  return match(text).pairs;
}

/** Splits `text` into runs of uniformly marked text, delimiters removed. */
export function parseInline(text: string): InlineRun[] {
  const { pieces } = match(text);
  const runs: InlineRun[] = [];
  const active = new Map<Mark, number>();

  const currentMarks = (): Mark[] => MARKS.filter((m) => (active.get(m) ?? 0) > 0);

  const pushChar = (ch: string, src: number) => {
    const marks = currentMarks();
    const last = runs[runs.length - 1];
    if (last && last.marks.length === marks.length && last.marks.every((m, i) => m === marks[i])) {
      last.text += ch;
      last.src.push(src);
    } else {
      runs.push({ text: ch, marks, src: [src] });
    }
  };

  for (const piece of pieces) {
    if (piece.kind === 'char') {
      pushChar(piece.ch, piece.src);
    } else if (piece.role === 'open') {
      active.set(piece.d.mark, (active.get(piece.d.mark) ?? 0) + 1);
    } else if (piece.role === 'close') {
      active.set(piece.d.mark, (active.get(piece.d.mark) ?? 0) - 1);
    } else {
      // Unmatched delimiter: literal text.
      for (let k = 0; k < piece.d.len; k++) pushChar(text[piece.d.start + k], piece.d.start + k);
    }
  }

  return runs;
}

/** The text a reader sees — for previews and search. */
export function stripInline(text: string): string {
  return parseInline(text).map((r) => r.text).join('');
}

/** True when `text` contains at least one matched delimiter pair. */
export function hasInlineMarks(text: string): boolean {
  return findPairs(text).length > 0;
}

/**
 * The marks that cover the whole selection, for the toolbar's active state.
 */
export function activeMarks(text: string, selStart: number, selEnd: number): Set<Mark> {
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  const out = new Set<Mark>();
  for (const p of findPairs(text)) {
    const inside = p.contentStart <= s && e <= p.contentEnd;
    const exactlyWrapped = p.openStart === s && p.closeEnd === e;
    if (inside || exactlyWrapped) out.add(p.mark);
  }
  return out;
}

export interface TextEdit {
  content: string;
  selStart: number;
  selEnd: number;
}

/**
 * Applies or removes a mark on the selected source range.
 *
 * - Selection not covered by that mark → wrapped. Whitespace at either end of
 *   the selection is kept outside the delimiters, since `** x**` would not parse.
 * - Selection covered by that mark → unmarked. If it covers only part of the
 *   marked span, the span is split so the rest keeps its mark.
 * - Collapsed or whitespace-only selection → unchanged.
 *
 * The returned selection covers the same visible text, so pressing the button
 * twice is a round trip.
 */
export function toggleMark(content: string, selStart: number, selEnd: number, mark: Mark): TextEdit {
  let s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);
  const unchanged: TextEdit = { content, selStart, selEnd };
  if (s === e) return unchanged;

  const D = MARK_DELIMITER[mark];
  const pairs = findPairs(content);
  const covering = pairs.find(
    (p) =>
      p.mark === mark &&
      ((p.contentStart <= s && e <= p.contentEnd) || (p.openStart === s && p.closeEnd === e)),
  );

  if (covering) {
    if (covering.openStart === s && covering.closeEnd === e) {
      s = covering.contentStart;
      e = covering.contentEnd;
    }

    // Source positions that are delimiters of OTHER pairs. A side made only of
    // those (plus whitespace) has no text of its own and must not be re-wrapped:
    // unbolding `***x***` should give `*x*`, not `***`-soup.
    const delimAt = new Set<number>();
    for (const p of pairs) {
      if (p === covering) continue;
      for (let k = p.openStart; k < p.contentStart; k++) delimAt.add(k);
      for (let k = p.contentEnd; k < p.closeEnd; k++) delimAt.add(k);
    }

    const rewrap = (from: number, to: number): string => {
      const part = content.slice(from, to);
      let hasText = false;
      for (let k = from; k < to; k++) {
        if (!delimAt.has(k) && !/\s/.test(content[k])) { hasText = true; break; }
      }
      if (!hasText) return part;
      const lead = part.match(/^\s*/)![0];
      const trail = part.slice(lead.length).match(/\s*$/)![0];
      return lead + D + part.slice(lead.length, part.length - trail.length) + D + trail;
    };

    const before = content.slice(0, covering.openStart);
    const left = rewrap(covering.contentStart, s);
    const mid = content.slice(s, e);
    const right = rewrap(e, covering.contentEnd);
    const after = content.slice(covering.closeEnd);

    const start = before.length + left.length;
    return { content: before + left + mid + right + after, selStart: start, selEnd: start + mid.length };
  }

  const raw = content.slice(s, e);
  const lead = raw.match(/^\s*/)![0].length;
  if (lead === raw.length) return unchanged;
  const trail = raw.match(/\s*$/)![0].length;

  const ws = s + lead;
  const we = e - trail;
  return {
    content: content.slice(0, ws) + D + content.slice(ws, we) + D + content.slice(we),
    selStart: ws + D.length,
    selEnd: we + D.length,
  };
}

/**
 * Maps an offset in the rendered (delimiter-free) text back to the source.
 *
 * Used to put the caret where the user clicked on rendered text. An offset at
 * the very end maps to the end of the source, after any closing delimiter, so
 * typing there continues unformatted.
 */
export function sourceOffsetFromRendered(text: string, renderedOffset: number): number {
  let count = 0;
  for (const run of parseInline(text)) {
    for (let i = 0; i < run.text.length; i++) {
      if (count === renderedOffset) return run.src[i];
      count++;
    }
  }
  return text.length;
}
