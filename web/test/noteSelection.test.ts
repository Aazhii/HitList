import { describe, it, expect } from 'vitest';
import type { NoteBlock } from '@/types/notes';
import {
  duplicateSubtrees, indentSelection, levelOf, moveSelection, removeSubtrees,
  selectRange, selectionIds, selectionRoots, subtreeIds,
} from '@/lib/noteBlocks';

const b = (id: string, indent = 0, extra: Partial<NoteBlock> = {}): NoteBlock =>
  ({ id, type: 'todo', content: id, ...(indent ? { indent } : {}), ...extra });
// a ── a1 ── a1x
//   └─ a2
// b
const list = (): NoteBlock[] => [b('a'), b('a1', 1), b('a1x', 2), b('a2', 1), b('b')];
const ids = (x: NoteBlock[]) => x.map((k) => k.id);

describe('selecting blocks with their children', () => {
  it('a parent covers everything nested under it', () => {
    expect(subtreeIds(list(), 'a')).toEqual(['a', 'a1', 'a1x', 'a2']);
    expect(subtreeIds(list(), 'a1')).toEqual(['a1', 'a1x']);
    expect(subtreeIds(list(), 'nope')).toEqual([]);
  });

  it('choosing a parent and its child is the same as choosing the parent', () => {
    expect(selectionRoots(list(), new Set(['a1', 'a']))).toEqual(['a']);
    expect(selectionRoots(list(), new Set(['a2', 'b']))).toEqual(['a2', 'b']);
    expect([...selectionIds(list(), new Set(['a1']))]).toEqual(['a1', 'a1x']);
  });

  it('a range skips what a closed toggle hides', () => {
    const l = [b('t', 0, { type: 'toggle', collapsed: true }), b('k', 1), b('x')];
    expect(selectRange(l, 't', 'x')).toEqual(['t', 'x']);
    expect(selectRange(l, 'x', 't')).toEqual(['t', 'x']);
  });
});

describe('acting on a selection', () => {
  it('deleting a parent deletes its children, and the rest keeps a valid outline', () => {
    expect(ids(removeSubtrees(list(), new Set(['a'])))).toEqual(['b']);
    const out = removeSubtrees(list(), new Set(['a1']));
    expect(ids(out)).toEqual(['a', 'a2', 'b']);
    expect(out.map(levelOf)).toEqual([0, 1, 0]);
  });

  it('deleting everything leaves one empty paragraph, never an empty note', () => {
    const out = removeSubtrees(list(), new Set(list().map((x) => x.id)));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'paragraph', content: '' });
  });

  it('returns the same list when nothing matches', () => {
    const l = list();
    expect(removeSubtrees(l, new Set(['zzz']))).toBe(l);
  });

  it('duplicates a parent with its children after the group, with new ids and no task link', () => {
    let n = 0;
    const l = [b('a', 0, { taskId: 't1' }), b('a1', 1, { taskId: 't2' }), b('b')];
    const { blocks, copies } = duplicateSubtrees(l, new Set(['a']), () => `c${n++}`);
    expect(ids(blocks)).toEqual(['a', 'a1', 'c0', 'c1', 'b']);
    expect(copies).toEqual(['c0']);
    expect(blocks.map(levelOf)).toEqual([0, 1, 0, 1, 0]);
    expect(blocks[2].taskId).toBeUndefined();
    expect(blocks[3].taskId).toBeUndefined();
    expect(blocks[0].taskId).toBe('t1');
  });

  it('moves a parent with its children past its neighbour', () => {
    expect(ids(moveSelection(list(), new Set(['a']), 'down'))).toEqual(['b', 'a', 'a1', 'a1x', 'a2']);
    const l = list();
    expect(moveSelection(l, new Set(['a']), 'up')).toBe(l);
  });

  it('indents and outdents every chosen block with its children', () => {
    const l = [b('x'), b('y'), b('y1', 1), b('z')];
    expect(indentSelection(l, new Set(['y']), 'in').map(levelOf)).toEqual([0, 1, 2, 0]);
    const nested = indentSelection(l, new Set(['y']), 'in');
    expect(indentSelection(nested, new Set(['y']), 'out').map(levelOf)).toEqual([0, 0, 1, 0]);
  });
});
