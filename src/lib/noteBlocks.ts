/**
 * Pure helpers over a note's block list.
 */
import type { NoteBlock } from '@/types/notes';

/**
 * The number each numbered-list block displays, keyed by block id.
 *
 * Numbering restarts at 1 for every contiguous run of numbered blocks. The
 * editor used to print the block's index in the whole note, so a list starting
 * after ten paragraphs read "11. 12. 13.", and two lists separated by a
 * paragraph carried on counting across the gap.
 *
 * Computed once per render in NoteEditor and passed down, rather than derived
 * inside each row from its index.
 */
export function computeNumberedOrdinals(blocks: readonly NoteBlock[]): Map<string, number> {
  const ordinals = new Map<string, number>();
  let run = 0;
  for (const block of blocks) {
    if (block.type === 'numbered') {
      run += 1;
      ordinals.set(block.id, run);
    } else {
      run = 0;
    }
  }
  return ordinals;
}
