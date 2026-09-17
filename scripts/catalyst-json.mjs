/**
 * Parses a Catalyst REST response without first coercing a ROWID through
 * JavaScript's lossy Number type.
 *
 * Catalyst can return ROWID as an unquoted JSON number even though its value
 * exceeds Number.MAX_SAFE_INTEGER. Keep that numeric token as a string; parse
 * every other JSON number normally.
 */
export function parseCatalystJson(source) {
  let index = 0;

  const fail = (message) => {
    throw new SyntaxError(`${message} at position ${index}`);
  };

  const skipWhitespace = () => {
    while (/\s/.test(source[index] ?? '')) index += 1;
  };

  const parseString = () => {
    const start = index;
    if (source[index] !== '"') fail('Expected string');
    index += 1;
    while (index < source.length) {
      const char = source[index++];
      if (char === '"') {
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          fail('Invalid string');
        }
      }
      if (char === '\\') {
        if (index >= source.length) fail('Unterminated escape sequence');
        index += 1;
      } else if (char < ' ') {
        fail('Control character in string');
      }
    }
    fail('Unterminated string');
  };

  const parseNumber = (key) => {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    match.lastIndex = index;
    const token = match.exec(source)?.[0];
    if (!token) fail('Expected number');
    index += token.length;

    if (key === 'ROWID' && /^-?\d+$/.test(token)) return token;
    const value = Number(token);
    if (!Number.isFinite(value)) fail('Invalid number');
    return value;
  };

  const parseValue = (key) => {
    skipWhitespace();
    const char = source[index];
    if (char === '"') return parseString();
    if (char === '{') return parseObject();
    if (char === '[') return parseArray();
    if (source.startsWith('true', index)) { index += 4; return true; }
    if (source.startsWith('false', index)) { index += 5; return false; }
    if (source.startsWith('null', index)) { index += 4; return null; }
    return parseNumber(key);
  };

  const parseObject = () => {
    const object = {};
    index += 1;
    skipWhitespace();
    if (source[index] === '}') { index += 1; return object; }

    while (true) {
      skipWhitespace();
      const key = parseString();
      skipWhitespace();
      if (source[index] !== ':') fail('Expected colon');
      index += 1;
      const value = parseValue(key);
      // Defining the property avoids the legacy __proto__ setter.
      Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
      skipWhitespace();
      if (source[index] === '}') { index += 1; return object; }
      if (source[index] !== ',') fail('Expected comma');
      index += 1;
    }
  };

  const parseArray = () => {
    const array = [];
    index += 1;
    skipWhitespace();
    if (source[index] === ']') { index += 1; return array; }

    while (true) {
      array.push(parseValue());
      skipWhitespace();
      if (source[index] === ']') { index += 1; return array; }
      if (source[index] !== ',') fail('Expected comma');
      index += 1;
    }
  };

  const result = parseValue();
  skipWhitespace();
  if (index !== source.length) fail('Unexpected trailing data');
  return result;
}
