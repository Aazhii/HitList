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

// ── Turn into, fold all, move to a new place ──────────────────────────────────────────────────────

/** Block kinds that are just a line of text, and so can be turned into one another in bulk. */
export const TEXT_BLOCK_TYPES: ReadonlySet<NoteBlock['type']> = new Set<NoteBlock['type']>([
  'paragraph', 'heading1', 'heading2', 'heading3', 'bullet', 'numbered', 'todo', 'toggle', 'quote',
]);

/**
 * Turns every block in `ids` into `type`. Only text-like lines change (a table, a database, a divider or code is
 * left as it is), and the type-specific fields follow the type, as changing one block's type always did.
 */
export function turnInto(blocks: NoteBlock[], ids: ReadonlySet<string>, type: NoteBlock['type']): NoteBlock[] {
  if (!TEXT_BLOCK_TYPES.has(type)) return blocks;
  let changed = false;
  const next = blocks.map((b) => {
    if (!ids.has(b.id) || b.type === type || !TEXT_BLOCK_TYPES.has(b.type)) return b;
    changed = true;
    const { checked: _c, collapsed: _o, ...rest } = b;
    return { ...rest, type, ...(type === 'todo' ? { checked: b.checked ?? false } : {}), ...(type === 'toggle' && b.collapsed ? { collapsed: true } : {}) };
  });
  return changed ? next : blocks;
}

/** ⌘⌥T: close every toggle that holds something, or open them all when they are all closed already. */
export function foldAllToggles(blocks: NoteBlock[]): NoteBlock[] {
  const holders = blocks.filter((b, i) => b.type === 'toggle' && toggleHasChildren(blocks, i));
  if (holders.length === 0) return blocks;
  const collapse = holders.some((b) => !b.collapsed);
  const ids = new Set(holders.map((b) => b.id));
  return blocks.map((b) => (ids.has(b.id) ? (collapse ? { ...b, collapsed: true } : (() => { const { collapsed: _o, ...rest } = b; return rest; })()) : b));
}

/**
 * Moves the chosen blocks, with their children, to sit before `beforeId` (null: the end) with the first of them at
 * `level`. Same array when that is where they already are, or when the target is inside what is being moved.
 */
export function moveSubtreesTo(blocks: NoteBlock[], chosen: ReadonlySet<string>, beforeId: string | null, level: number): NoteBlock[] {
  const roots = selectionRoots(blocks, chosen);
  if (roots.length === 0) return blocks;
  const moving = new Set(roots.flatMap((root) => subtreeIds(blocks, root)));
  if (beforeId && moving.has(beforeId)) return blocks;
  const group = blocks.filter((b) => moving.has(b.id));
  const rest = blocks.filter((b) => !moving.has(b.id));
  const at = beforeId ? rest.findIndex((b) => b.id === beforeId) : rest.length;
  if (at === -1) return blocks;
  const delta = level - levelOf(group[0]);
  const shifted = group.map((b) => withLevel(b, Math.min(MAX_INDENT, Math.max(0, levelOf(b) + delta))));
  const next = normalizeIndents([...rest.slice(0, at), ...shifted, ...rest.slice(at)]);
  const same = next.length === blocks.length && next.every((b, i) => b.id === blocks[i].id && levelOf(b) === levelOf(blocks[i]));
  return same ? blocks : next;
}

export interface DropTarget {
  /** The shown block the dragged ones go under, or null for the very top. */
  afterId: string | null;
  /** What `moveSubtreesTo` needs: the block they go before (null: the end), and their level. */
  beforeId: string | null;
  level: number;
}

/**
 * Where a drag lands. `rows` is where each shown block is on screen; `y` is the pointer's height and `dx` how far
 * right (or left) it has moved since the drag began, in steps of `step` pixels per level. The dragged blocks go
 * after the last shown block whose middle is above the pointer, level with it; dragging right nests them under it
 * (not under a closed toggle, whose children are hidden), left brings them out.
 */
export function computeDrop(
  blocks: readonly NoteBlock[],
  chosen: ReadonlySet<string>,
  rows: ReadonlyMap<string, { top: number; bottom: number }>,
  y: number,
  dx: number,
  step: number,
): DropTarget | null {
  const roots = selectionRoots(blocks, chosen);
  if (roots.length === 0) return null;
  const moving = new Set(roots.flatMap((root) => subtreeIds(blocks, root)));
  const hidden = hiddenBlockIds(blocks);
  const stops = blocks.filter((b) => !moving.has(b.id) && !hidden.has(b.id) && rows.has(b.id));
  let after: NoteBlock | null = null;
  for (const b of stops) {
    const r = rows.get(b.id)!;
    if ((r.top + r.bottom) / 2 < y) after = b; else break;
  }
  const rest = blocks.filter((b) => !moving.has(b.id));
  let beforeId: string | null;
  let level = 0;
  if (!after) {
    beforeId = rest[0]?.id ?? null;
  } else {
    const at = blocks.indexOf(after);
    const resume = after.type === 'toggle' && after.collapsed ? subtreeEnd(blocks, at) : at + 1;
    beforeId = blocks.slice(resume).find((b) => !moving.has(b.id))?.id ?? null;
    const max = after.type === 'toggle' && after.collapsed ? levelOf(after) : Math.min(MAX_INDENT, levelOf(after) + 1);
    level = Math.min(max, Math.max(0, levelOf(after) + Math.round(dx / step)));
  }
  return { afterId: after?.id ?? null, beforeId, level };
}

// ── Find in a note ───────────────────────────────────────────────────────────────────────────────

export interface FindMatch {
  blockId: string;
  /** Which occurrence within the block (0 first). */
  nth: number;
}

function fold(text: string, matchCase: boolean): string {
  return matchCase ? text : text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The text of a block as it is searched: its content, and a table's cells. */
function searchableText(block: NoteBlock): string {
  if (block.type === 'table') return (block.tableData?.rows ?? []).map((row) => row.join('\t')).join('\n');
  return block.content;
}

/**
 * Every place `query` occurs across the note, in reading order. Case and accents are ignored unless `matchCase`.
 * Hidden lines (inside a closed toggle) are searched too; going to one opens the toggles above it.
 */
export function findMatches(blocks: readonly NoteBlock[], query: string, matchCase = false): FindMatch[] {
  const needle = fold(query, matchCase);
  if (needle === '') return [];
  const found: FindMatch[] = [];
  for (const block of blocks) {
    const text = fold(searchableText(block), matchCase);
    let at = text.indexOf(needle);
    let nth = 0;
    while (at !== -1) {
      found.push({ blockId: block.id, nth });
      nth += 1;
      at = text.indexOf(needle, at + needle.length);
    }
  }
  return found;
}

/** The note with every closed toggle above `id` opened, so the line can be seen. Same array when it already can. */
export function revealBlock(blocks: NoteBlock[], id: string): NoteBlock[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i === -1) return blocks;
  let level = levelOf(blocks[i]);
  const open = new Set<string>();
  for (let j = i - 1; j >= 0 && level > 0; j -= 1) {
    if (levelOf(blocks[j]) < level) {
      level = levelOf(blocks[j]);
      if (blocks[j].type === 'toggle' && blocks[j].collapsed) open.add(blocks[j].id);
    }
  }
  if (open.size === 0) return blocks;
  return blocks.map((b) => (open.has(b.id) ? (() => { const { collapsed: _o, ...rest } = b; return rest; })() : b));
}
