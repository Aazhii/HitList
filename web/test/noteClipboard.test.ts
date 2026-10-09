import { describe, it, expect } from 'vitest';
import type { NoteBlock } from '@/types/notes';
import { blocksToText, fromClipboard, pasteBlocksAfter, toClipboard } from '@/lib/noteClipboard';
import { levelOf } from '@/lib/noteBlocks';

const b = (id: string, type: NoteBlock['type'], content: string, indent = 0, extra: Partial<NoteBlock> = {}): NoteBlock =>
  ({ id, type, content, ...(indent ? { indent } : {}), ...extra });

const sample = () => [
  b('p', 'paragraph', 'intro'),
  b('a', 'todo', 'parent', 0, { taskId: 'T1', checked: true }),
  b('a1', 'todo', 'child', 1),
  b('a2', 'bullet', 'grandchild', 2),
  b('z', 'paragraph', 'after'),
];

describe('copying blocks', () => {
  it('copies a chosen parent with its children, indentation shown as text, no task link', () => {
    const out = toClipboard(sample(), new Set(['a']))!;
    expect(out.text).toBe('[x] parent\n  [ ] child\n    - grandchild');
    const copied = JSON.parse(out.json) as NoteBlock[];
    expect(copied.map((x) => x.id)).toEqual(['a', 'a1', 'a2']);
    expect(copied.some((x) => 'taskId' in x)).toBe(false);
    expect(toClipboard(sample(), new Set())).toBeNull();
  });

  it('text of other block kinds', () => {
    expect(blocksToText([b('h', 'heading2', 'Title'), b('d', 'divider', ''), b('t', 'toggle', 'More', 0), b('q', 'quote', 'said', 1)]))
      .toBe('## Title\n---\n> More\n  | said');
  });
});

describe('pasting blocks', () => {
  it('round-trips with new ids and the same shape, and levels the group to the top', () => {
    let n = 0;
    const json = toClipboard(sample(), new Set(['a1']))!.json;
    const pasted = fromClipboard(json, () => `n${n++}`)!;
    expect(pasted.map((x) => [x.id, x.content, levelOf(x)])).toEqual([['n0', 'child', 0], ['n1', 'grandchild', 1]]);
  });

  it('refuses anything that is not our format, and drops unknown fields', () => {
    expect(fromClipboard('not json')).toBeNull();
    expect(fromClipboard('{}')).toBeNull();
    expect(fromClipboard('[]')).toBeNull();
    expect(fromClipboard('[{"type":"evil","content":"x"}]')).toBeNull();
    expect(fromClipboard('[{"type":"todo","content":5}]')).toBeNull();
    const ok = fromClipboard('[{"type":"todo","content":"x","taskId":"T9","checked":true,"onclick":"boom"}]')!;
    expect(ok[0]).toMatchObject({ type: 'todo', content: 'x', checked: true });
    expect('taskId' in ok[0]).toBe(false);
    expect('onclick' in ok[0]).toBe(false);
  });

  it('goes after the block and its children, at that block\'s level', () => {
    const pasted = fromClipboard(JSON.stringify([b('x', 'todo', 'new'), b('y', 'todo', 'new child', 1)]), () => crypto.randomUUID())!;
    const { blocks, ids } = pasteBlocksAfter(sample(), 'a', pasted);
    expect(blocks.map((x) => x.content)).toEqual(['intro', 'parent', 'child', 'grandchild', 'new', 'new child', 'after']);
    expect(blocks.map(levelOf)).toEqual([0, 0, 1, 2, 0, 1, 0]);
    expect(ids).toHaveLength(2);
  });

  it('replaces an empty text line instead of leaving it behind', () => {
    const pasted = fromClipboard(JSON.stringify([b('x', 'todo', 'new')]))!;
    const { blocks } = pasteBlocksAfter([b('e', 'paragraph', ''), b('z', 'paragraph', 'after')], 'e', pasted);
    expect(blocks.map((x) => x.content)).toEqual(['new', 'after']);
  });

  it('nests pasted blocks under a nested line', () => {
    const pasted = fromClipboard(JSON.stringify([b('x', 'bullet', 'n'), b('y', 'bullet', 'm', 1)]))!;
    const { blocks } = pasteBlocksAfter([b('a', 'bullet', 'a'), b('a1', 'bullet', 'a1', 1)], 'a1', pasted);
    expect(blocks.map(levelOf)).toEqual([0, 1, 1, 2]);
  });
});
