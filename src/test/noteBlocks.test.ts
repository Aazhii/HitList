/**
 * Numbered-list ordinals.
 *
 * The bug this replaces printed a block's index in the whole note, so the
 * cases worth pinning are the ones that bug got wrong: a list that does not
 * start at the top, and two lists separated by something else.
 */
import { describe, it, expect } from 'vitest';
import { computeNumberedOrdinals } from '@/lib/noteBlocks';
import type { BlockType, NoteBlock } from '@/types/notes';

function blocks(...types: BlockType[]): NoteBlock[] {
  return types.map((type, i) => ({ id: `b${i}`, type, content: '' }));
}

describe('computeNumberedOrdinals', () => {
  it('numbers a list that starts after other blocks from 1', () => {
    const list = blocks('paragraph', 'paragraph', 'numbered', 'numbered', 'numbered');
    const ordinals = computeNumberedOrdinals(list);
    expect([ordinals.get('b2'), ordinals.get('b3'), ordinals.get('b4')]).toEqual([1, 2, 3]);
  });

  it('restarts after a block of another type', () => {
    const list = blocks('numbered', 'numbered', 'paragraph', 'numbered');
    const ordinals = computeNumberedOrdinals(list);
    expect(ordinals.get('b1')).toBe(2);
    expect(ordinals.get('b3')).toBe(1);
  });

  it('treats a bullet list between numbered runs as a break', () => {
    const list = blocks('numbered', 'bullet', 'numbered');
    const ordinals = computeNumberedOrdinals(list);
    expect(ordinals.get('b0')).toBe(1);
    expect(ordinals.get('b2')).toBe(1);
  });

  it('assigns nothing to blocks that are not numbered', () => {
    const ordinals = computeNumberedOrdinals(blocks('paragraph', 'todo'));
    expect(ordinals.size).toBe(0);
  });
});
