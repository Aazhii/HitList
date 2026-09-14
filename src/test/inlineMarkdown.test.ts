/**
 * Inline formatting stored as delimiters in a block's content.
 *
 * The parser runs over every existing note, so the tests that matter most are
 * the ones where ordinary text must NOT turn into formatting — identifiers,
 * arithmetic, language names. A false positive there silently changes what
 * someone wrote.
 *
 * The toggle is tested as the round trip a user performs: press Bold, press it
 * again, and the text must be back where it started.
 */
import { describe, it, expect } from 'vitest';
import {
  parseInline,
  stripInline,
  findPairs,
  activeMarks,
  toggleMark,
  sourceOffsetFromRendered,
  type Mark,
} from '@/lib/inlineMarkdown';

/** Runs as [text, marks] for compact expectations. */
function runs(text: string): Array<[string, Mark[]]> {
  return parseInline(text).map((r) => [r.text, r.marks]);
}

describe('parseInline — formatting', () => {
  it('leaves plain text as a single unmarked run', () => {
    expect(runs('hello world')).toEqual([['hello world', []]]);
  });

  it('parses each mark', () => {
    expect(runs('**b**')).toEqual([['b', ['bold']]]);
    expect(runs('*i*')).toEqual([['i', ['italic']]]);
    expect(runs('++u++')).toEqual([['u', ['underline']]]);
    expect(runs('~~s~~')).toEqual([['s', ['strike']]]);
  });

  it('keeps surrounding text', () => {
    expect(runs('a **b** c')).toEqual([['a ', []], ['b', ['bold']], [' c', []]]);
  });

  it('parses bold and italic together', () => {
    expect(runs('***both***')).toEqual([['both', ['bold', 'italic']]]);
  });

  it('nests marks', () => {
    expect(runs('**bold *and italic* bold**')).toEqual([
      ['bold ', ['bold']],
      ['and italic', ['bold', 'italic']],
      [' bold', ['bold']],
    ]);
  });
});

describe('parseInline — text that must stay literal', () => {
  it('does not touch snake_case or dunder names', () => {
    expect(stripInline('snake_case and __init__')).toBe('snake_case and __init__');
    expect(findPairs('snake_case and __init__')).toEqual([]);
  });

  it('does not treat arithmetic as italic', () => {
    expect(findPairs('2 * 3 * 4')).toEqual([]);
    expect(stripInline('2 * 3 * 4')).toBe('2 * 3 * 4');
  });

  it('does not treat C++ as underline', () => {
    expect(findPairs('C++ and C++')).toEqual([]);
    expect(stripInline('C++ and C++')).toBe('C++ and C++');
  });

  it('leaves an unmatched delimiter as text', () => {
    expect(stripInline('**open')).toBe('**open');
    expect(stripInline('close**')).toBe('close**');
  });

  it('does not create an empty mark', () => {
    expect(findPairs('****')).toEqual([]);
    expect(stripInline('****')).toBe('****');
  });

  it('honours backslash escapes', () => {
    expect(runs('\\*not italic\\*')).toEqual([['*not italic*', []]]);
  });

  it('keeps a lone backslash', () => {
    expect(stripInline('C:\\path')).toBe('C:\\path');
  });
});

describe('stripInline', () => {
  it('removes matched delimiters only', () => {
    expect(stripInline('a **b** *c* ++d++ ~~e~~ **f')).toBe('a b c d e **f');
  });
});

describe('activeMarks', () => {
  it('reports marks covering the selection', () => {
    const text = 'a **bold** c';
    const start = text.indexOf('bold');
    expect(activeMarks(text, start, start + 4)).toEqual(new Set(['bold']));
  });

  it('counts a selection that includes the delimiters', () => {
    expect(activeMarks('**x**', 0, 5)).toEqual(new Set(['bold']));
  });

  it('reports nothing for a selection that only partly overlaps', () => {
    const text = '**bold** tail';
    expect(activeMarks(text, 4, 12)).toEqual(new Set());
  });
});

describe('toggleMark — applying', () => {
  it('wraps the selection and keeps the same text selected', () => {
    const out = toggleMark('make this bold', 5, 9, 'bold');
    expect(out.content).toBe('make **this** bold');
    expect(out.content.slice(out.selStart, out.selEnd)).toBe('this');
  });

  it('keeps whitespace outside the delimiters', () => {
    // `** this **` would not parse, so the spaces stay out.
    const out = toggleMark('a  this  b', 1, 9, 'italic');
    expect(out.content).toBe('a  *this*  b');
    expect(stripInline(out.content)).toBe('a  this  b');
  });

  it('does nothing for a collapsed selection', () => {
    expect(toggleMark('text', 2, 2, 'bold')).toEqual({ content: 'text', selStart: 2, selEnd: 2 });
  });

  it('does nothing for a whitespace-only selection', () => {
    expect(toggleMark('a   b', 1, 4, 'bold').content).toBe('a   b');
  });

  it('accepts a backwards selection', () => {
    expect(toggleMark('make this bold', 9, 5, 'bold').content).toBe('make **this** bold');
  });
});

describe('toggleMark — removing', () => {
  it('removes the mark when the selection is exactly the marked text', () => {
    const text = 'make **this** bold';
    const s = text.indexOf('this');
    const out = toggleMark(text, s, s + 4, 'bold');
    expect(out.content).toBe('make this bold');
    expect(out.content.slice(out.selStart, out.selEnd)).toBe('this');
  });

  it('removes the mark when the selection includes the delimiters', () => {
    expect(toggleMark('**x**', 0, 5, 'bold').content).toBe('x');
  });

  it('splits a marked span when only part of it is selected', () => {
    const text = '**abc**';
    const out = toggleMark(text, 3, 4, 'bold'); // "b"
    expect(out.content).toBe('**a**b**c**');
    expect(runs(out.content)).toEqual([['a', ['bold']], ['b', []], ['c', ['bold']]]);
    expect(out.content.slice(out.selStart, out.selEnd)).toBe('b');
  });

  it('keeps whitespace outside the delimiters when splitting', () => {
    const text = '**one two three**';
    const s = text.indexOf('two');
    const out = toggleMark(text, s, s + 3, 'bold');
    expect(runs(out.content)).toEqual([
      ['one', ['bold']], [' two ', []], ['three', ['bold']],
    ]);
  });

  it('removes only the mark asked for from bold + italic', () => {
    const text = '***x***';
    const s = text.indexOf('x');
    expect(runs(toggleMark(text, s, s + 1, 'bold').content)).toEqual([['x', ['italic']]]);
    expect(runs(toggleMark(text, s, s + 1, 'italic').content)).toEqual([['x', ['bold']]]);
  });
});

describe('toggleMark — round trips', () => {
  const marks: Mark[] = ['bold', 'italic', 'underline', 'strike'];

  it.each(marks)('%s applied then removed restores the text', (mark) => {
    const original = 'the quick brown fox';
    const on = toggleMark(original, 4, 9, mark);
    const off = toggleMark(on.content, on.selStart, on.selEnd, mark);
    expect(off.content).toBe(original);
    expect(off.content.slice(off.selStart, off.selEnd)).toBe('quick');
  });

  it('stacks two marks and unstacks them', () => {
    const bold = toggleMark('word', 0, 4, 'bold');
    const both = toggleMark(bold.content, bold.selStart, bold.selEnd, 'italic');
    expect(runs(both.content)).toEqual([['word', ['bold', 'italic']]]);

    const noItalic = toggleMark(both.content, both.selStart, both.selEnd, 'italic');
    const plain = toggleMark(noItalic.content, noItalic.selStart, noItalic.selEnd, 'bold');
    expect(plain.content).toBe('word');
  });
});

describe('sourceOffsetFromRendered', () => {
  it('maps through delimiters', () => {
    // rendered "a bold c": offset 2 is "b", which is at source index 4.
    const text = 'a **bold** c';
    expect(sourceOffsetFromRendered(text, 2)).toBe(4);
  });

  it('maps a position after a marked span to after its closer', () => {
    // rendered "bold!": offset 4 is "!", after the closing ** at source 8.
    expect(sourceOffsetFromRendered('**bold**!', 4)).toBe(8);
  });

  it('maps the end to the end of the source', () => {
    expect(sourceOffsetFromRendered('**bold**', 4)).toBe(8);
  });

  it('is the identity for plain text', () => {
    expect(sourceOffsetFromRendered('plain', 3)).toBe(3);
  });
});
