/**
 * Note previews feed the sidebar and search. Both must see what a reader sees,
 * not the delimiters formatting is stored as.
 */
import { describe, it, expect } from 'vitest';
import { getNotePreview } from '@/types/notes';
import type { Note, NoteBlock } from '@/types/notes';

function note(...blocks: Array<Pick<NoteBlock, 'type' | 'content'>>): Note {
  return {
    id: 'n1',
    title: 'T',
    createdAt: 0,
    updatedAt: 0,
    blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })),
  };
}

describe('getNotePreview', () => {
  it('strips inline formatting markers', () => {
    expect(getNotePreview(note({ type: 'paragraph', content: 'a **bold** and *italic* idea' })))
      .toBe('a bold and italic idea');
  });

  it('leaves code untouched, since its stars are content', () => {
    expect(getNotePreview(note({ type: 'code', content: 'a * b * c' }))).toBe('a * b * c');
  });

  it('skips blocks whose text is only markers', () => {
    // "****" is literal, so it counts as text — but a block of just spaces does not.
    expect(getNotePreview(note({ type: 'paragraph', content: '   ' }, { type: 'paragraph', content: 'next' })))
      .toBe('next');
  });

  it('still skips dividers and tables', () => {
    expect(getNotePreview(note({ type: 'divider', content: '' }, { type: 'quote', content: '~~old~~ new' })))
      .toBe('old new');
  });
});
