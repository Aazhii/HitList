import { describe, it, expect } from 'vitest';
import type { NoteBlock } from '@/types/notes';
import { findMatches, hiddenBlockIds, revealBlock } from '@/lib/noteBlocks';

const b = (id: string, content: string, indent = 0, extra: Partial<NoteBlock> = {}): NoteBlock =>
  ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}), ...extra });

describe('findMatches', () => {
  const list = [b('a', 'Customer remark'), b('b', 'no match here'), b('c', 'remark and REMARK again'), b('d', 'Café')];
  it('finds every occurrence in reading order, ignoring case', () => {
    expect(findMatches(list, 'remark')).toEqual([
      { blockId: 'a', nth: 0 }, { blockId: 'c', nth: 0 }, { blockId: 'c', nth: 1 },
    ]);
  });
  it('can match case, and ignores accents otherwise', () => {
    expect(findMatches(list, 'REMARK', true)).toEqual([{ blockId: 'c', nth: 0 }]);
    expect(findMatches(list, 'cafe').map((m) => m.blockId)).toEqual(['d']);
    expect(findMatches(list, 'cafe', true)).toEqual([]);
  });
  it('an empty query matches nothing, and repeats do not overlap', () => {
    expect(findMatches(list, '')).toEqual([]);
    expect(findMatches([b('x', 'aaaa')], 'aa')).toHaveLength(2);
  });
  it('searches a table\'s cells and lines hidden in a closed toggle', () => {
    const l = [
      b('t', 'T', 0, { type: 'toggle', collapsed: true }), b('k', 'secret', 1),
      b('tb', '', 0, { type: 'table', tableData: { rows: [['x', 'needle']], hasHeader: false } }),
    ];
    expect(findMatches(l, 'secret').map((m) => m.blockId)).toEqual(['k']);
    expect(findMatches(l, 'needle').map((m) => m.blockId)).toEqual(['tb']);
    expect(hiddenBlockIds(l).has('k')).toBe(true);
  });
});

describe('revealBlock', () => {
  it('opens every closed toggle above a hidden line, and only those', () => {
    const l = [
      b('t1', 'one', 0, { type: 'toggle', collapsed: true }),
      b('t2', 'two', 1, { type: 'toggle', collapsed: true }),
      b('k', 'deep', 2),
      b('t3', 'other', 0, { type: 'toggle', collapsed: true }),
    ];
    const out = revealBlock(l, 'k');
    expect(out.map((x) => !!x.collapsed)).toEqual([false, false, false, true]);
    expect(revealBlock(out, 'k')).toBe(out);
    expect(revealBlock(l, 'nope')).toBe(l);
  });
});
