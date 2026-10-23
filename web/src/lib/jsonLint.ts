/**
 * A JSON checker that says what is wrong and where, in plain words ("Missing ',' between values"), which JSON.parse's
 * "Unexpected token } in JSON at position 31" does not. Pure and dependency-free; reports the first problem only, since the
 * ones after it are usually its echo.
 */
export interface JsonProblem {
  from: number;
  to: number;
  message: string;
}

class Stop extends Error {
  constructor(readonly problem: JsonProblem) { super(problem.message); }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/y;

export function lintJson(text: string): JsonProblem[] {
  if (!text.trim()) return [];
  let pos = 0;
  const end = text.length;

  const fail = (from: number, to: number, message: string): never => {
    const start = Math.min(Math.max(0, from), Math.max(0, end - 1));
    throw new Stop({ from: start, to: Math.min(end, Math.max(to, start + 1)), message });
  };
  const skip = () => { while (pos < end && /\s/.test(text[pos])) pos += 1; };
  const show = (ch: string | undefined) => (ch === undefined ? 'the end' : `'${ch}'`);
  const close = (open: string) => (open === '{' ? '}' : ']');

  const string = (): void => {
    const start = pos;
    pos += 1;
    while (pos < end) {
      const ch = text[pos];
      if (ch === '\\') { pos += 2; continue; }
      if (ch === '"') { pos += 1; return; }
      if (ch === '\n') break;
      pos += 1;
    }
    const lineEnd = text.indexOf('\n', start);
    fail(start, lineEnd === -1 ? end : lineEnd, 'This string is missing its closing quote (")');
  };

  const value = (): void => {
    skip();
    const ch = text[pos];
    if (ch === '{' || ch === '[') return container(ch);
    if (ch === '"') return string();
    NUMBER.lastIndex = pos;
    const num = NUMBER.exec(text);
    if (num) { pos += num[0].length; return; }
    WORD.lastIndex = pos;
    const word = WORD.exec(text);
    if (word) {
      if (['true', 'false', 'null'].includes(word[0])) { pos += word[0].length; return; }
      fail(pos, pos + word[0].length, `'${word[0]}' is not valid JSON; text must be in "double quotes" (true, false and null have none)`);
    }
    if (ch === "'") fail(pos, pos + 1, 'Strings use "double quotes" in JSON, not single quotes');
    if (ch === '/') fail(pos, pos + 2, 'Comments are not allowed in JSON');
    if (ch === ',' || ch === '}' || ch === ']' || ch === ':') fail(pos, pos + 1, `Missing a value before ${show(ch)}`);
    return fail(pos, pos + 1, ch === undefined ? 'Missing a value at the end' : `Unexpected ${show(ch)}; expected a value`);
  };

  const container = (open: string): void => {
    const opener = pos;
    const closer = close(open);
    pos += 1;
    skip();
    if (text[pos] === closer) { pos += 1; return; }
    let comma = -1;
    for (;;) {
      skip();
      if (open === '{') {
        if (text[pos] === closer && comma !== -1) fail(comma, comma + 1, `Extra ',' before the ${closer}; JSON does not allow a trailing comma`);
        if (pos >= end) fail(opener, opener + 1, `Missing ${closer} to close this ${open}`);
        if (text[pos] !== '"') {
          WORD.lastIndex = pos;
          const word = WORD.exec(text);
          if (word) fail(pos, pos + word[0].length, `The key '${word[0]}' must be in "double quotes"`);
          fail(pos, pos + 1, `Expected a "key" here, found ${show(text[pos])}`);
        }
        string();
        skip();
        if (text[pos] !== ':') fail(pos >= end ? end : pos, pos + 1, "Missing ':' after the key");
        pos += 1;
      } else if (text[pos] === closer && comma !== -1) {
        fail(comma, comma + 1, `Extra ',' before the ${closer}; JSON does not allow a trailing comma`);
      }
      if (pos >= end && open === '[') fail(opener, opener + 1, `Missing ${closer} to close this ${open}`);
      value();
      skip();
      if (pos >= end) fail(opener, opener + 1, `Missing ${closer} to close this ${open}`);
      if (text[pos] === ',') { comma = pos; pos += 1; continue; }
      if (text[pos] === closer) { pos += 1; return; }
      if (text[pos] === '}' || text[pos] === ']') fail(pos, pos + 1, `Found ${show(text[pos])} but this ${open} (opened earlier) needs a ${closer}`);
      fail(pos, pos + 1, `Missing ',' between values (found ${show(text[pos])})`);
    }
  };

  try {
    value();
    skip();
    if (pos < end) fail(pos, pos + 1, `Unexpected ${show(text[pos])} after the end of the JSON`);
    return [];
  } catch (e) {
    if (e instanceof Stop) return [e.problem];
    throw e;
  }
}
