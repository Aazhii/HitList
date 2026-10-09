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

import { computeDrop, foldAllToggles, moveSubtreesTo, turnInto } from '@/lib/noteBlocks';

describe('turning a selection into another kind', () => {
  it('changes only text-like lines and fixes the type-specific fields', () => {
    const l = [b('a', 0, { type: 'todo', checked: true }), b('t', 0, { type: 'table' }), b('c', 0, { type: 'paragraph' })];
    const out = turnInto(l, new Set(['a', 't', 'c']), 'bullet');
    expect(out.map((x) => x.type)).toEqual(['bullet', 'table', 'bullet']);
    expect(out[0].checked).toBeUndefined();
    const todo = turnInto([b('c', 0, { type: 'paragraph' })], new Set(['c']), 'todo');
    expect(todo[0].checked).toBe(false);
    expect(turnInto(l, new Set(['a']), 'table')).toBe(l);
    expect(turnInto(l, new Set(['a']), 'todo')).toBe(l);
  });
});

describe('fold all toggles', () => {
  const t = (id: string, indent = 0, extra: Partial<NoteBlock> = {}) => b(id, indent, { type: 'toggle', ...extra });
  it('closes every toggle that holds something, then opens them all', () => {
    const l = [t('x'), b('k', 1, { type: 'paragraph' }), t('empty'), t('y', 0, { collapsed: true }), b('k2', 1, { type: 'paragraph' })];
    const closed = foldAllToggles(l);
    expect(closed.map((n) => !!n.collapsed)).toEqual([true, false, false, true, false]);
    expect(foldAllToggles(closed).map((n) => !!n.collapsed)).toEqual([false, false, false, false, false]);
    expect(foldAllToggles([b('p')])).toEqual([b('p')]);
  });
});

describe('moving a group to a new place', () => {
  it('moves a parent with its children and keeps the outline valid', () => {
    const out = moveSubtreesTo(list(), new Set(['a']), null, 0);
    expect(out.map((x) => x.id)).toEqual(['b', 'a', 'a1', 'a1x', 'a2']);
    expect(out.map(levelOf)).toEqual([0, 0, 1, 2, 1]);
  });
  it('can drop a group inside another block as its child', () => {
    const out = moveSubtreesTo(list(), new Set(['a']), null, 1);
    expect(out.map((x) => [x.id, levelOf(x)])).toEqual([['b', 0], ['a', 1], ['a1', 2], ['a1x', 3], ['a2', 2]]);
  });
  it('does nothing when dropped onto itself or where it already is', () => {
    const l = list();
    expect(moveSubtreesTo(l, new Set(['a']), 'a1', 0)).toBe(l);
    expect(moveSubtreesTo(l, new Set(['a']), 'b', 0)).toBe(l);
    expect(moveSubtreesTo(l, new Set(['a']), 'nope', 0)).toBe(l);
  });
});

describe('where a drag lands', () => {
  const l = [b('a'), b('a1', 1), b('b'), b('c')];
  const rows = new Map([['a', { top: 0, bottom: 20 }], ['a1', { top: 20, bottom: 40 }], ['b', { top: 40, bottom: 60 }], ['c', { top: 60, bottom: 80 }]]);
  it('goes under the last row whose middle is above the pointer, level with it', () => {
    expect(computeDrop(l, new Set(['c']), rows, 45, 0, 24)).toEqual({ afterId: 'a1', beforeId: 'b', level: 1 });
    expect(computeDrop(l, new Set(['c']), rows, 55, 0, 24)).toEqual({ afterId: 'b', beforeId: null, level: 0 });
    expect(computeDrop(l, new Set(['c']), rows, 5, 0, 24)).toEqual({ afterId: null, beforeId: 'a', level: 0 });
    expect(computeDrop(l, new Set(['a']), rows, 100, 0, 24)).toEqual({ afterId: 'c', beforeId: null, level: 0 });
  });
  it('dragging right nests under that row, left brings it out, never past what is possible', () => {
    expect(computeDrop(l, new Set(['c']), rows, 45, 30, 24)?.level).toBe(2);
    expect(computeDrop(l, new Set(['c']), rows, 45, 200, 24)?.level).toBe(2);
    expect(computeDrop(l, new Set(['c']), rows, 45, -30, 24)?.level).toBe(0);
  });
  it('never drops into what is being dragged, and nests under a closed toggle only as a sibling', () => {
    expect(computeDrop(l, new Set(['a']), rows, 45, 0, 24)?.afterId).toBeNull();
    const closed = [b('t', 0, { type: 'toggle', collapsed: true }), b('k', 1), b('z')];
    const r = new Map([['t', { top: 0, bottom: 20 }], ['k', { top: 20, bottom: 40 }], ['z', { top: 20, bottom: 40 }]]);
    expect(computeDrop(closed, new Set(['z']), r, 30, 80, 24)).toEqual({ afterId: 't', beforeId: null, level: 0 });
  });
});
