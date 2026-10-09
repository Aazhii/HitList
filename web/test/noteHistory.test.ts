import { describe, it, expect } from 'vitest';
import type { NoteBlock } from '@/types/notes';
import { HISTORY_LIMIT, NoteHistory, TYPING_GAP_MS, typedBlockId } from '@/lib/noteHistory';

const b = (id: string, content = id, extra: Partial<NoteBlock> = {}): NoteBlock => ({ id, type: 'paragraph', content, ...extra });

describe('typedBlockId', () => {
  it('names the block when only its text changed', () => {
    const a = b('a'); const c = b('c');
    expect(typedBlockId([a, c], [{ ...a, content: 'ax' }, c])).toBe('a');
  });
  it('is null for structure changes, several blocks, or a change besides the text', () => {
    const a = b('a'); const c = b('c');
    expect(typedBlockId([a], [a, c])).toBeNull();
    expect(typedBlockId([a, c], [{ ...a, content: 'x' }, { ...c, content: 'y' }])).toBeNull();
    expect(typedBlockId([a], [{ ...a, content: 'x', indent: 1 }])).toBeNull();
    expect(typedBlockId([a], [a])).toBeNull();
  });
});

describe('NoteHistory', () => {
  it('undoes and redoes whole-list changes, per note', () => {
    const h = new NoteHistory();
    const one = [b('a')]; const two = [b('a'), b('b')];
    h.record('n1', one, two, 0);
    h.record('n2', [b('z')], [], 0);
    expect(h.undo('n1', two)).toBe(one);
    expect(h.canUndo('n1')).toBe(false);
    expect(h.canUndo('n2')).toBe(true);
    expect(h.redo('n1', one)).toBe(two);
    expect(h.undo('n9', two)).toBeNull();
  });

  it('keystrokes in one block close together are a single step; a pause or another block starts a new one', () => {
    const h = new NoteHistory();
    const a0 = b('a', ''); const c = b('c');
    const a1 = { ...a0, content: 'h' }; const a2 = { ...a0, content: 'hi' }; const a3 = { ...a0, content: 'hi there' };
    h.record('n', [a0, c], [a1, c], 0);
    h.record('n', [a1, c], [a2, c], 100);
    expect(h.undo('n', [a2, c])?.[0].content).toBe('');
    expect(h.canUndo('n')).toBe(false);
    h.redo('n', [a0, c]);
    h.record('n', [a2, c], [a3, c], 100 + TYPING_GAP_MS + 1);
    expect(h.undo('n', [a3, c])?.[0].content).toBe('hi');
  });

  it('a structural change always starts its own step', () => {
    const h = new NoteHistory();
    const a = b('a'); const c = b('c');
    h.record('n', [a], [{ ...a, content: 'x' }], 0);
    h.record('n', [{ ...a, content: 'x' }], [{ ...a, content: 'x' }, c], 10);
    expect(h.undo('n', [])?.length).toBe(1);
    expect(h.undo('n', [])?.[0].content).toBe('a');
  });

  it('a new edit after an undo drops the redo steps', () => {
    const h = new NoteHistory();
    h.record('n', [b('a')], [b('a'), b('b')], 0);
    h.undo('n', [b('a'), b('b')]);
    expect(h.canRedo('n')).toBe(true);
    h.record('n', [b('a')], [b('a'), b('c')], 5000);
    expect(h.canRedo('n')).toBe(false);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    const h = new NoteHistory();
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) h.record('n', [b(`s${i}`)], [b(`s${i + 1}`), b('x')], i);
    let count = 0;
    while (h.undo('n', [])) count += 1;
    expect(count).toBe(HISTORY_LIMIT);
  });

  it('forgets a note, and everything not kept', () => {
    const h = new NoteHistory();
    h.record('a', [b('1')], [b('1'), b('2')], 0);
    h.record('b', [b('1')], [b('1'), b('2')], 0);
    h.forgetExcept(new Set(['a']));
    expect(h.canUndo('a')).toBe(true);
    expect(h.canUndo('b')).toBe(false);
    h.clear();
    expect(h.canUndo('a')).toBe(false);
  });
});
