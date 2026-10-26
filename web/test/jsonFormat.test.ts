import { describe, it, expect } from 'vitest';
import { formatJson } from '@/lib/jsonFormat';

const ok = (text: string, indent = '  ') => {
  const result = formatJson(text, indent);
  if (result.problem) throw new Error(`expected valid JSON, got: ${result.problem.message}`);
  return result.text;
};

describe('laying JSON out again', () => {
  it('lays a single line out, at the indentation it is given', () => {
    expect(ok('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(ok('{"a":1}', '    ')).toBe('{\n    "a": 1\n}');
    expect(ok('{"a":1}', '\t')).toBe('{\n\t"a": 1\n}');
  });

  it('fixes indentation that is wrong rather than merely absent', () => {
    const crooked = '{\n        "a": 1,\n"b": {\n "c": 2\n      }\n}';
    expect(ok(crooked)).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}');
  });

  it('running it twice changes nothing the second time', () => {
    const once = ok('{"a":[{"b":"c"}],"d":null}');
    expect(ok(once)).toBe(once);
  });

  it('keeps empty objects and arrays on their line', () => {
    expect(ok('{"a":{},"b":[],"c":[{}]}')).toBe('{\n  "a": {},\n  "b": [],\n  "c": [\n    {}\n  ]\n}');
    expect(ok('{   }')).toBe('{}');
  });

  it('hands back every token exactly as it was written', () => {
    // JSON.parse + JSON.stringify would reorder these keys, because they look like whole numbers.
    expect(ok('{"2":"b","1":"a"}')).toBe('{\n  "2": "b",\n  "1": "a"\n}');
    // …round this number, which is longer than a JavaScript one…
    expect(ok('{"n":12345678901234567890}')).toContain('12345678901234567890');
    expect(ok('{"n":1.0,"m":1e10,"z":-0}')).toBe('{\n  "n": 1.0,\n  "m": 1e10,\n  "z": -0\n}');
    // …and keep only the last of a repeated key.
    expect(ok('{"a":1,"a":2}')).toBe('{\n  "a": 1,\n  "a": 2\n}');
  });

  it('leaves the inside of a string alone, braces, commas, slashes and escapes included', () => {
    expect(ok('{"a":"{{Id}}, [x] // y"}')).toBe('{\n  "a": "{{Id}}, [x] // y"\n}');
    expect(ok('{"a":"say \\"hi\\"","b":"back\\\\slash"}')).toBe('{\n  "a": "say \\"hi\\"",\n  "b": "back\\\\slash"\n}');
  });

  it('keeps a comment that had its own line on its own line', () => {
    expect(ok('{\n// which module\n"a":1\n}')).toBe('{\n  // which module\n  "a": 1\n}');
    expect(ok('[\n1,\n// a note\n2\n]')).toBe('[\n  1,\n  // a note\n  2\n]');
  });

  it('keeps a comment that trailed a line on that line, so it still points at the same thing', () => {
    expect(ok('{"a":1, // first\n"b":2 // second\n}')).toBe('{\n  "a": 1, // first\n  "b": 2 // second\n}');
    expect(ok('{ // opening\n"a":1\n}')).toBe('{ // opening\n  "a": 1\n}');
  });

  it('keeps a block comment', () => {
    expect(ok('{/* why */"a":1}')).toBe('{ /* why */\n  "a": 1\n}');
  });

  it('refuses text that is not JSON, and says where, in the checker\'s own words', () => {
    const source = '{\n  "a": 1,\n  "b":\n}';
    const result = formatJson(source, '  ');
    expect(result.problem?.line).toBe(4);
    expect(result.problem?.message).toMatch(/Missing a value/);
    // The text comes back untouched, so a caller cannot half-apply a failed tidy-up.
    expect(result.text).toBe(source);
  });

  it('an empty file is left as it is', () => {
    expect(ok('')).toBe('');
    expect(ok('   \n  ')).toBe('   \n  ');
  });
});
