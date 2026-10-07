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
  // One counter per indent level. A block at a shallower level ends the runs of everything deeper, so nested
  // lists start again at 1 under each parent.
  const runs: number[] = [];
  for (const block of blocks) {
    const level = levelOf(block);
    runs.length = level + 1;
    if (block.type === 'numbered') {
      runs[level] = (runs[level] ?? 0) + 1;
      ordinals.set(block.id, runs[level]);
    } else {
      runs[level] = 0;
    }
  }
  return ordinals;
}

// ── Indentation (Tab / Shift+Tab) ─────────────────────────────────────────────

/** How deep a line can go. */
export const MAX_INDENT = 6;
export const MAX_TODO_INDENT = 4;

/** A block's level: 0 (top) when it has none. */
export function levelOf(block: Pick<NoteBlock, 'indent'>): number {
  const n = block.indent ?? 0;
  return Number.isFinite(n) ? Math.min(MAX_INDENT, Math.max(0, Math.floor(n))) : 0;
}

function withLevel(block: NoteBlock, level: number): NoteBlock {
  if (level <= 0) {
    if (block.indent === undefined) return block;
    const { indent: _drop, ...rest } = block;
    return rest;
  }
  return block.indent === level ? block : { ...block, indent: level };
}

/**
 * Keeps the outline valid: the first block is at the top, and no block is more than one level deeper than the
 * one above it. Run after anything that moves or removes blocks, so a child never floats deeper than its parent.
 * Returns the same array when nothing changes.
 */
export function normalizeIndents(blocks: NoteBlock[]): NoteBlock[] {
  const out: NoteBlock[] = [];
  let changed = false;
  blocks.forEach((block, i) => {
    const max = i === 0 ? 0 : levelOf(out[i - 1]) + 1;
    const next = withLevel(block, Math.min(levelOf(block), max));
    if (next !== block) changed = true;
    out.push(next);
  });
  return changed ? out : blocks;
}

/** Index just after a block and everything nested under it (the blocks after it that are deeper). */
export function subtreeEnd(blocks: readonly NoteBlock[], index: number): number {
  const level = levelOf(blocks[index]);
  let end = index + 1;
  while (end < blocks.length && levelOf(blocks[end]) > level) end += 1;
  return end;
}

/** Whether Tab can push this block in: not the first block, and not already one deeper than the block above. */
export function canIndent(blocks: readonly NoteBlock[], id: string): boolean {
  const i = blocks.findIndex((b) => b.id === id);
  return i > 0 && levelOf(blocks[i]) <= levelOf(blocks[i - 1])
    && blocks.slice(i, subtreeEnd(blocks, i)).every((block) =>
      levelOf(block) < (block.type === 'todo' ? MAX_TODO_INDENT : MAX_INDENT));
}

/** Pushes a block in one level, its children with it. Same array when it cannot move. */
export function indentBlock(blocks: NoteBlock[], id: string): NoteBlock[] {
  if (!canIndent(blocks, id)) return blocks;
  const i = blocks.findIndex((b) => b.id === id);
  const end = subtreeEnd(blocks, i);
  const deepest = Math.max(...blocks.slice(i, end).map(levelOf));
  if (deepest >= MAX_INDENT) return blocks;
  return blocks.map((b, k) => (k >= i && k < end ? withLevel(b, levelOf(b) + 1) : b));
}

/** Brings a block back out one level, its children with it. Same array when it is already at the top. */
export function outdentBlock(blocks: NoteBlock[], id: string): NoteBlock[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i === -1 || levelOf(blocks[i]) === 0) return blocks;
  const end = subtreeEnd(blocks, i);
  return normalizeIndents(blocks.map((b, k) => (k >= i && k < end ? withLevel(b, levelOf(b) - 1) : b)));
}

/**
 * The level for a block inserted straight after `blocks[index]` by Enter: nested one deeper when that block
 * has children (the new line is the first of them), otherwise level with it.
 */
export function levelForNewBlockAfter(blocks: readonly NoteBlock[], index: number): number {
  const here = blocks[index];
  if (!here) return 0;
  // An open toggle takes the new line inside it; a closed one gets a sibling after everything it holds.
  if (here.type === 'toggle') return Math.min(MAX_INDENT, levelOf(here) + (here.collapsed ? 0 : 1));
  const hasChildren = index + 1 < blocks.length && levelOf(blocks[index + 1]) > levelOf(here);
  return Math.min(here.type === 'todo' ? MAX_TODO_INDENT : MAX_INDENT, levelOf(here) + (hasChildren ? 1 : 0));
}

/**
 * Moves a block, with everything nested under it, above the previous block at the same level or below the next one.
 * Same array when there is no such neighbour (it would have to leave its parent).
 */
export function moveBlockWithChildren(blocks: NoteBlock[], id: string, direction: 'up' | 'down'): NoteBlock[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i === -1) return blocks;
  const level = levelOf(blocks[i]);
  const end = subtreeEnd(blocks, i);
  if (direction === 'up') {
    let j = i - 1;
    while (j >= 0 && levelOf(blocks[j]) > level) j -= 1;
    if (j < 0 || levelOf(blocks[j]) !== level) return blocks;
    return [...blocks.slice(0, j), ...blocks.slice(i, end), ...blocks.slice(j, i), ...blocks.slice(end)];
  }
  if (end >= blocks.length || levelOf(blocks[end]) !== level) return blocks;
  const nextEnd = subtreeEnd(blocks, end);
  return [...blocks.slice(0, i), ...blocks.slice(end, nextEnd), ...blocks.slice(i, end), ...blocks.slice(nextEnd)];
}

/** Where a line added after `blocks[index]` goes: straight after it, or after everything inside it when it is a closed toggle. */
export function insertIndexAfter(blocks: readonly NoteBlock[], index: number): number {
  const here = blocks[index];
  return here && here.type === 'toggle' && here.collapsed ? subtreeEnd(blocks, index) : index + 1;
}

/** Ids of the blocks that are not shown because a toggle above them (at any depth) is closed. */
export function hiddenBlockIds(blocks: readonly NoteBlock[]): Set<string> {
  const hidden = new Set<string>();
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'toggle' && block.collapsed) {
      const end = subtreeEnd(blocks, i);
      for (let k = i + 1; k < end; k += 1) hidden.add(blocks[k].id);
      i = end;
    } else {
      i += 1;
    }
  }
  return hidden;
}

/** Whether a toggle holds anything: the block after it is nested deeper. */
export function toggleHasChildren(blocks: readonly NoteBlock[], index: number): boolean {
  return index + 1 < blocks.length && levelOf(blocks[index + 1]) > levelOf(blocks[index]);
}
