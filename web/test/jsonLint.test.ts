import { describe, it, expect } from 'vitest';
import { lintJson } from '@/lib/jsonLint';

const one = (text: string) => { const found = lintJson(text); expect(found).toHaveLength(1); return found[0]; };
const at = (text: string, p: { from: number; to: number }) => text.slice(p.from, p.to);

describe('lintJson', () => {
  it('accepts valid JSON of every shape, and an empty file', () => {
    for (const ok of ['', '  \n', '{}', '[]', '{"a": [1, 2.5, -3e2, true, false, null, "x\\"y"], "b": {"c": {}}}', '"just a string"', '42', '[\n  {"a": 1},\n  {"a": 2}\n]\n']) {
      expect(lintJson(ok), ok).toEqual([]);
    }
  });

  it('a missing closing brace or bracket points at the one left open', () => {
    const a = '{"a": {"b": 1}';
    expect(one(a).message).toBe('Missing } to close this {');
    expect(one(a).from).toBe(0);
    const b = '{"a": [1, 2}';
    expect(one(b).message).toContain("needs a ]");
    expect(at(b, one(b))).toBe('}');
    const c = '[1, 2';
    expect(one(c).message).toBe('Missing ] to close this [');
    expect(one('{"a": 1,').message).toBe('Missing } to close this {');
  });

  it('a stray closer is reported', () => {
    expect(one('{"a": 1}}').message).toBe("Unexpected '}' after the end of the JSON");
    expect(one('[1]]').message).toBe("Unexpected ']' after the end of the JSON");
  });

  it('an unterminated string points at its opening quote', () => {
    const text = '{"a": "hello,\n "b": 2}';
    const p = one(text);
    expect(p.message).toContain('missing its closing quote');
    expect(p.from).toBe(text.indexOf('"hello'));
    expect(one('{"a').message).toContain('closing quote');
  });

  it('a missing comma, a missing colon, a trailing comma', () => {
    const c = '{"a": 1\n "b": 2}';
    expect(one(c).message).toContain("Missing ','");
    expect(at(c, one(c))).toBe('"');
    expect(one('{"a" 1}').message).toBe("Missing ':' after the key");
    const t = '{"a": 1,}';
    expect(one(t).message).toContain('trailing comma');
    expect(at(t, one(t))).toBe(',');
    expect(one('[1, 2,]').message).toContain('trailing comma');
  });

  it('unquoted keys and words, single quotes, a missing value', () => {
    expect(one('{a: 1}').message).toBe(`The key 'a' must be in "double quotes"`);
    expect(one('{"a": yes}').message).toContain("'yes' is not valid JSON");
    expect(one("{'a': 1}").message).toContain('Expected a "key"');
    expect(one("['a']").message).toContain('single quotes');
    expect(one('{"a": }').message).toBe("Missing a value before '}'");
    expect(one('{"a":').message).toContain('Missing');
  });

  it('accepts comments, as the editor and Beautify do, but not one left open', () => {
    // The editor writes these with ⌘/ and Beautify keeps them, so underlining them here would be arguing with the app.
    expect(lintJson('// note\n{}')).toEqual([]);
    expect(lintJson('{\n  // which module\n  "a": 1 // and why\n}')).toEqual([]);
    expect(lintJson('{"a": /* inline */ 1}')).toEqual([]);
    expect(lintJson('// nothing but a note')).toEqual([]);
    expect(one('{"a": /* open').message).toContain('missing its closing */');
    // Everything else stays as strict as it was.
    expect(one('{"a": 1,}').message).toContain('trailing comma');
  });

  it('never throws and always stays inside the text, whatever it is given', () => {
    for (const junk of ['{', '[', '"', '{"', '{"a"', '{"a":', '[,', ',', ':', '}', '\\', '{"a": "\\', '[1 2]', 'nul', '-', '1.', '{"a":1 "b"']) {
      const found = lintJson(junk);
      for (const p of found) { expect(p.from).toBeGreaterThanOrEqual(0); expect(p.to).toBeLessThanOrEqual(junk.length); expect(p.to).toBeGreaterThan(p.from); }
    }
  });
});
