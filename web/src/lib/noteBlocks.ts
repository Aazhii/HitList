/**
 * Pure helpers over a note's block list.
 */
import type { NoteBlock } from '@/types/notes';
import { createEmptyBlock } from '@/types/notes';

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

// ── Selecting and acting on several blocks (a parent always goes with its children) ───────────────

/** Ids of a block and everything nested under it, in document order. */
export function subtreeIds(blocks: readonly NoteBlock[], id: string): string[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i === -1) return [];
  return blocks.slice(i, subtreeEnd(blocks, i)).map((b) => b.id);
}

/**
 * The blocks a selection acts on: each chosen block that is not already inside another chosen block's subtree,
 * in document order. Choosing a parent and one of its children is the same as choosing the parent.
 */
export function selectionRoots(blocks: readonly NoteBlock[], chosen: ReadonlySet<string>): string[] {
  const roots: string[] = [];
  let coveredUntil = -1;
  blocks.forEach((block, i) => {
    if (i < coveredUntil || !chosen.has(block.id)) return;
    roots.push(block.id);
    coveredUntil = subtreeEnd(blocks, i);
  });
  return roots;
}

/** Every id a selection covers: its roots and all their children. */
export function selectionIds(blocks: readonly NoteBlock[], chosen: ReadonlySet<string>): Set<string> {
  const all = new Set<string>();
  for (const root of selectionRoots(blocks, chosen)) for (const id of subtreeIds(blocks, root)) all.add(id);
  return all;
}

/** The blocks from `from` to `to` (either order) that are shown, for Shift+click: a closed toggle's children are not separate stops. */
export function selectRange(blocks: readonly NoteBlock[], from: string, to: string): string[] {
  const hidden = hiddenBlockIds(blocks);
  const a = blocks.findIndex((b) => b.id === from);
  const b = blocks.findIndex((x) => x.id === to);
  if (a === -1 || b === -1) return [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return blocks.slice(lo, hi + 1).filter((x) => !hidden.has(x.id)).map((x) => x.id);
}

/**
 * The note after removing the chosen blocks with their children. A note is never left with no blocks: it gets one
 * empty paragraph, as deleting the last block always did. Same array when nothing matches.
 */
export function removeSubtrees(blocks: NoteBlock[], chosen: ReadonlySet<string>): NoteBlock[] {
  const gone = selectionIds(blocks, chosen);
  if (gone.size === 0) return blocks;
  const kept = blocks.filter((b) => !gone.has(b.id));
  return kept.length === 0 ? [createEmptyBlock('paragraph')] : normalizeIndents(kept);
}

/**
 * Copies the chosen blocks (with their children) right after themselves, with new ids. A copy is not linked to the
 * original's task (a task belongs to one line) and is not collapsed state-shared; a database block keeps pointing at
 * the same database. Returns the new list and the ids of the copies' roots.
 */
export function duplicateSubtrees(
  blocks: NoteBlock[],
  chosen: ReadonlySet<string>,
  newId: () => string = () => crypto.randomUUID(),
): { blocks: NoteBlock[]; copies: string[] } {
  const roots = selectionRoots(blocks, chosen);
  if (roots.length === 0) return { blocks, copies: [] };
  const copies: string[] = [];
  const out: NoteBlock[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    out.push(blocks[i]);
    if (!roots.includes(blocks[i].id)) continue;
    const end = subtreeEnd(blocks, i);
    const group = blocks.slice(i, end).map((b) => {
      const { taskId: _task, ...rest } = b;
      return { ...rest, id: newId() } as NoteBlock;
    });
    copies.push(group[0].id);
    // The children come right after the parent in the original; put the copies after the whole group.
    out.push(...blocks.slice(i + 1, end), ...group);
    i = end - 1;
  }
  return { blocks: out, copies };
}

/** Moves each chosen block, with its children, up or down past its neighbour at the same level. Same array when none can move. */
export function moveSelection(blocks: NoteBlock[], chosen: ReadonlySet<string>, direction: 'up' | 'down'): NoteBlock[] {
  const roots = selectionRoots(blocks, chosen);
  const order = direction === 'up' ? roots : [...roots].reverse();
  let next = blocks;
  for (const id of order) next = moveBlockWithChildren(next, id, direction);
  return next;
}

/** Tab / Shift+Tab for a selection: each chosen block, with its children, one level in or out. */
export function indentSelection(blocks: NoteBlock[], chosen: ReadonlySet<string>, direction: 'in' | 'out'): NoteBlock[] {
  let next = blocks;
  for (const id of selectionRoots(blocks, chosen)) {
    next = direction === 'in' ? indentBlock(next, id) : outdentBlock(next, id);
  }
  return next;
}
