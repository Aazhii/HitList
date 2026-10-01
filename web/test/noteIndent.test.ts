import { describe, expect, it } from 'vitest';
import {
  canIndent, computeNumberedOrdinals, indentBlock, levelForNewBlockAfter, levelOf, moveBlockWithChildren,
  normalizeIndents, outdentBlock, subtreeEnd,
} from '@/lib/noteBlocks';
import type { BlockType, NoteBlock } from '@/types/notes';

const b = (id: string, indent = 0, type: BlockType = 'paragraph'): NoteBlock => ({ id, type, content: id, ...(indent ? { indent } : {}) });
const ids = (blocks: NoteBlock[]) => blocks.map((x) => x.id).join(',');
const levels = (blocks: NoteBlock[]) => blocks.map(levelOf).join('');

describe('indenting', () => {
  it('limits to-dos to five visible levels while other blocks retain six indent steps', () => {
    const blocks = Array.from({ length: 5 }, (_, index) => b(`todo-${index}`, index, 'todo'));
    const candidate = [...blocks, b('next', 3, 'todo')];
    const indented = indentBlock(candidate, 'next');
    expect(levelOf(indented[5])).toBe(4);
    expect(canIndent(indented, 'next')).toBe(false);
    expect(indentBlock(indented, 'next')).toBe(indented);
    expect(levelForNewBlockAfter(indented, 5)).toBe(4);
    const paragraphs = [...blocks, b('paragraph', 4)];
    expect(levelOf(indentBlock(paragraphs, 'paragraph')[5])).toBe(5);
  });

  it('does not push a parent when a nested to-do is already at level five', () => {
    const blocks = [b('a'), b('parent'), b('child', 1), b('child2', 2), b('child3', 3), b('todo', 4, 'todo')];
    expect(canIndent(blocks, 'parent')).toBe(false);
    expect(indentBlock(blocks, 'parent')).toBe(blocks);
    expect(levelOf(outdentBlock(blocks, 'parent')[5])).toBe(4);
  });

  it('pushes a block in under the one above, and not the first block', () => {
    const blocks = [b('a'), b('b')];
    expect(levels(indentBlock(blocks, 'b'))).toBe('01');
    expect(indentBlock(blocks, 'a')).toBe(blocks);
    expect(canIndent(blocks, 'a')).toBe(false);
  });

  it('cannot go more than one level deeper than the line above', () => {
    const blocks = [b('a'), b('b', 1)];
    expect(canIndent(blocks, 'b')).toBe(false);
    expect(indentBlock(blocks, 'b')).toBe(blocks);
    const flat = [b('a'), b('b'), b('c')];
    expect(levels(indentBlock(indentBlock(flat, 'b'), 'c'))).toBe('011');
    expect(levels(indentBlock(indentBlock(indentBlock(flat, 'b'), 'c'), 'c'))).toBe('012');
  });

  it('moves a block\'s children with it', () => {
    const blocks = [b('a'), b('b'), b('c', 1), b('d', 2), b('e')];
    expect(levels(indentBlock(blocks, 'b'))).toBe('01230');
  });

  it('brings a block and its children back out one level, never below the top', () => {
    const blocks = [b('a'), b('b', 1), b('c', 2), b('d', 1)];
    expect(levels(outdentBlock(blocks, 'b'))).toBe('0011');
    expect(outdentBlock(blocks, 'a')).toBe(blocks);
  });

  it('outdenting a middle sibling keeps the outline valid for what follows', () => {
    const blocks = [b('a'), b('b', 1), b('c', 1), b('d', 1)];
    expect(levels(outdentBlock(blocks, 'b'))).toBe('0011');
    expect(levels(normalizeIndents(outdentBlock(blocks, 'b')))).toBe('0011');
  });

  it('keeps the outline valid after blocks are removed', () => {
    const blocks = [b('a'), b('b', 1), b('c', 2)];
    expect(levels(normalizeIndents([blocks[0], blocks[2]]))).toBe('01');
    expect(levels(normalizeIndents([b('x', 3), b('y', 4)]))).toBe('01');
    const fine = [b('a'), b('b', 1)];
    expect(normalizeIndents(fine)).toBe(fine);
  });

  it('finds the end of a block\'s children', () => {
    const blocks = [b('a'), b('b', 1), b('c', 2), b('d', 1), b('e')];
    expect(subtreeEnd(blocks, 0)).toBe(4);
    expect(subtreeEnd(blocks, 1)).toBe(3);
    expect(subtreeEnd(blocks, 4)).toBe(5);
  });

  it('puts a new line level with its block, or first among its children', () => {
    expect(levelForNewBlockAfter([b('a'), b('b', 1)], 1)).toBe(1);
    expect(levelForNewBlockAfter([b('a'), b('b', 1)], 0)).toBe(1);
    expect(levelForNewBlockAfter([b('a'), b('b')], 0)).toBe(0);
  });

  it('moves a block with its children past a sibling, and stays put when it would have to leave its parent', () => {
    const blocks = [b('a'), b('b', 1), b('c'), b('d', 1), b('e')];
    expect(ids(moveBlockWithChildren(blocks, 'c', 'up'))).toBe('c,d,a,b,e');
    expect(ids(moveBlockWithChildren(blocks, 'a', 'down'))).toBe('c,d,a,b,e');
    expect(moveBlockWithChildren(blocks, 'b', 'up')).toBe(blocks);
    expect(moveBlockWithChildren(blocks, 'b', 'down')).toBe(blocks);
    expect(ids(moveBlockWithChildren([b('a'), b('b'), b('c')], 'b', 'up'))).toBe('b,a,c');
  });
});

describe('numbering with levels', () => {
  it('restarts under each parent and carries on after the nested list ends', () => {
    const blocks = [
      b('1', 0, 'numbered'), b('1a', 1, 'numbered'), b('1b', 1, 'numbered'),
      b('2', 0, 'numbered'), b('2a', 1, 'numbered'), b('p'), b('3', 0, 'numbered'),
    ];
    const n = computeNumberedOrdinals(blocks);
    expect(['1', '1a', '1b', '2', '2a', '3'].map((id) => n.get(id))).toEqual([1, 1, 2, 2, 1, 1]);
  });

  it('keeps counting across a nested non-numbered line', () => {
    const n = computeNumberedOrdinals([b('1', 0, 'numbered'), b('note', 1, 'bullet'), b('2', 0, 'numbered')]);
    expect(n.get('2')).toBe(2);
  });
});
