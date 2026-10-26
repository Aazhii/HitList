import { lintJson } from '@/lib/jsonLint';

/**
 * Laying JSON out again — "Beautify" in Postman, and what people reach for when a file arrives on one long line or with
 * the indentation half right. (Wrap, next to it in the toolbar, only folds long lines so they stay in view; it changes no
 * text. They are different jobs and this is the one that moves things.)
 *
 * It moves whitespace and nothing else. Every token is copied across exactly as it was written, which `JSON.parse` followed
 * by `JSON.stringify` cannot promise: that route reorders keys that look like whole numbers ({"2":…,"1":…} comes back the
 * other way round), rounds a number too long for a JavaScript one (12345678901234567890 becomes …7000), and quietly drops
 * all but the last of a repeated key. A code editor must hand back the same document, so this walks the text instead.
 *
 * Comments are kept, because the editor lets you write them (⌘/ — see codeLanguages). One that sat on its own line keeps
 * its own line; one that trailed a value stays on that value's line, so it still annotates what it was written against.
 *
 * Text that is not JSON at all is refused rather than guessed at, and the reason comes from the same checker that
 * underlines the problem in the editor, so the two always agree.
 */
export interface JsonFormatProblem {
  /** Plain language, from `lintJson`. */
  message: string;
  /** 1-based, for "Line 3: …". */
  line: number;
}

export interface JsonFormatResult {
  /** The text laid out again — or, when `problem` is set, the text exactly as it came in. */
  text: string;
  /** Why it could not be laid out, or null when it was. */
  problem: JsonFormatProblem | null;
}

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
/** Where a literal (a number, true, false, null) ends. */
const STRUCTURAL = new Set(['{', '}', '[', ']', ',', ':', '"']);

/** The end of the comment starting at `from`, or -1 if one does not start there. */
function commentEnd(text: string, from: number): number {
  if (text[from] !== '/') return -1;
  if (text[from + 1] === '/') {
    const line = text.indexOf('\n', from);
    return line === -1 ? text.length : line;
  }
  if (text[from + 1] === '*') {
    const close = text.indexOf('*/', from + 2);
    return close === -1 ? text.length : close + 2;
  }
  return -1;
}

/** Whether anything other than space sits before `at` on its own line — that is what makes a comment a trailing one. */
function sharesLineWithSomething(text: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i -= 1) {
    if (text[i] === '\n') return false;
    if (!isSpace(text[i])) return true;
  }
  return false;
}

export function formatJson(text: string, indentUnit: string): JsonFormatResult {
  const [found] = lintJson(text);
  if (found) {
    return { text, problem: { message: found.message, line: text.slice(0, found.from).split('\n').length } };
  }
  if (!text.trim()) return { text, problem: null };

  const end = text.length;
  let out = '';
  let depth = 0;
  let at = 0;
  // Set after a comment: whatever comes next begins a new line, or it would be swallowed by the comment.
  let breakFirst = false;

  const newline = (level: number) => `\n${indentUnit.repeat(level)}`;
  const skipSpace = (from: number) => { let i = from; while (i < end && isSpace(text[i])) i += 1; return i; };
  /** Everything but a closer, which lays out its own line break anyway. */
  const open = () => { if (breakFirst) { out += newline(depth); breakFirst = false; } };
  /**
   * A comment written after `{`, `[` or `,` on the same line belongs to that line, and these are the three places that
   * break the line straight away — so it has to be taken before the break, not after it.
   */
  const trailing = () => {
    let i = at;
    while (i < end && (text[i] === ' ' || text[i] === '\t')) i += 1;
    const close = commentEnd(text, i);
    if (close === -1) return '';
    const body = ` ${text.slice(i, close).trimEnd()}`;
    at = close;
    return body;
  };

  while (at < end) {
    const ch = text[at];
    if (isSpace(ch)) { at += 1; continue; }

    const comment = commentEnd(text, at);
    if (comment !== -1) {
      const body = text.slice(at, comment).trimEnd();
      if (sharesLineWithSomething(text, at)) out += ` ${body}`;
      else { open(); if (out && !out.endsWith(newline(depth))) out += newline(depth); out += body; }
      breakFirst = true;
      at = comment;
      continue;
    }

    if (ch === '"') {
      // Copied whole, so a brace, a comma or a // inside a string is text, not structure.
      open();
      let i = at + 1;
      while (i < end) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"') { i += 1; break; }
        i += 1;
      }
      out += text.slice(at, i);
      at = i;
      continue;
    }

    if (ch === '{' || ch === '[') {
      open();
      const closer = ch === '{' ? '}' : ']';
      const next = skipSpace(at + 1);
      // An empty one stays on its line: {} and [], the way every formatter writes them.
      if (text[next] === closer) { out += ch + closer; at = next + 1; continue; }
      depth += 1;
      out += ch;
      at += 1;
      out += trailing() + newline(depth);
      continue;
    }

    if (ch === '}' || ch === ']') {
      depth -= 1;
      breakFirst = false;
      out += newline(depth) + ch;
      at += 1;
      continue;
    }

    if (ch === ',') {
      breakFirst = false;
      out += ',';
      at += 1;
      out += trailing() + newline(depth);
      continue;
    }
    if (ch === ':') { open(); out += ': '; at += 1; continue; }

    open();
    let i = at;
    while (i < end && !isSpace(text[i]) && !STRUCTURAL.has(text[i]) && commentEnd(text, i) === -1) i += 1;
    out += text.slice(at, i);
    at = i;
  }

  return { text: out, problem: null };
}
