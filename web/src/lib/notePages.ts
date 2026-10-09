/**
 * Pages inside pages. A sub-page is an ordinary note; its parent is the note that holds a `page` block pointing at
 * it (Notion's model). So the tree is read from the notes' blocks and nothing about nesting is stored on the child.
 *
 * A note can in principle be pointed at by two page blocks (a copied block, an older version): the first wins. A
 * cycle (A holds B, B holds A) is never produced by the app and is cut here if it ever appears.
 */
import type { Note, NoteBlock } from '@/types/notes';

type NoteLike = Pick<Note, 'id' | 'blocks'>;

/** The ids a note holds as sub-pages, in the order they appear in it. */
export function pageTargets(note: Pick<Note, 'blocks'>): string[] {
  const ids: string[] = [];
  for (const b of note.blocks) if (b.type === 'page' && b.pageId && !ids.includes(b.pageId)) ids.push(b.pageId);
  return ids;
}

/** child id → parent id, for every note that is somebody's sub-page. */
export function parentMap(notes: readonly NoteLike[]): Map<string, string> {
  const exists = new Set(notes.map((n) => n.id));
  const parents = new Map<string, string>();
  const reaches = (from: string, target: string): boolean => {
    for (let at: string | undefined = from, hops = 0; at !== undefined && hops <= notes.length; at = parents.get(at), hops += 1) {
      if (at === target) return true;
    }
    return false;
  };
  for (const note of notes) {
    for (const child of pageTargets(note)) {
      if (child === note.id || !exists.has(child) || parents.has(child)) continue;
      // Making `note` the parent of `child` is refused when `note` is already below `child`.
      if (reaches(note.id, child)) continue;
      parents.set(child, note.id);
    }
  }
  return parents;
}

/** The sub-pages of a note that exist, in the order they appear in it. */
export function childrenOf(notes: readonly NoteLike[], parents: ReadonlyMap<string, string>, id: string): string[] {
  const note = notes.find((n) => n.id === id);
  return note ? pageTargets(note).filter((c) => parents.get(c) === id) : [];
}

/** From the top-level page down to the direct parent; empty for a top-level page. */
export function ancestorsOf(parents: ReadonlyMap<string, string>, id: string): string[] {
  const chain: string[] = [];
  for (let at = parents.get(id); at !== undefined && !chain.includes(at); at = parents.get(at)) chain.unshift(at);
  return chain;
}

/** Everything under a page, depth first. */
export function descendantsOf(notes: readonly NoteLike[], parents: ReadonlyMap<string, string>, id: string): string[] {
  const out: string[] = [];
  const visit = (at: string) => {
    for (const child of childrenOf(notes, parents, at)) {
      if (out.includes(child)) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(id);
  return out;
}

/** Whether making `parentId` the parent of `id` would put a page inside itself. */
export function wouldCycle(parents: ReadonlyMap<string, string>, id: string, parentId: string | null): boolean {
  if (parentId === null) return false;
  return parentId === id || ancestorsOf(parents, parentId).includes(id);
}

export interface TreeRow<T extends NoteLike> {
  note: T;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/**
 * The notes as the sidebar tree: top-level pages in the order given, each followed by its sub-pages (when expanded)
 * in the order they appear in it. `expanded` holds the ids that are open.
 */
export function treeRows<T extends NoteLike>(notes: readonly T[], parents: ReadonlyMap<string, string>, expanded: ReadonlySet<string>): Array<TreeRow<T>> {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const rows: Array<TreeRow<T>> = [];
  const visit = (note: T, depth: number, seen: Set<string>) => {
    const kids = childrenOf(notes, parents, note.id).filter((c) => byId.has(c) && !seen.has(c));
    const open = expanded.has(note.id);
    rows.push({ note, depth, hasChildren: kids.length > 0, expanded: open });
    if (!open) return;
    for (const kid of kids) visit(byId.get(kid)!, depth + 1, new Set([...seen, kid]));
  };
  for (const note of notes) if (!parents.has(note.id)) visit(note, 0, new Set([note.id]));
  return rows;
}

/** The block a parent holds for a sub-page. */
export function newPageBlock(child: Pick<Note, 'id' | 'title'>, id: string = crypto.randomUUID()): NoteBlock {
  return { id, type: 'page', content: child.title || 'Untitled', pageId: child.id };
}

/** Blocks without the page blocks that point at any of `ids`. Same array when there are none. */
export function withoutPages(blocks: NoteBlock[], ids: ReadonlySet<string>): NoteBlock[] {
  const kept = blocks.filter((b) => !(b.type === 'page' && b.pageId && ids.has(b.pageId)));
  return kept.length === blocks.length ? blocks : kept;
}

/** Blocks with a page block for `child` added at the end (an empty last line is used up instead). Same array when already there. */
export function withPage(blocks: NoteBlock[], child: Pick<Note, 'id' | 'title'>, blockId?: string): NoteBlock[] {
  if (blocks.some((b) => b.type === 'page' && b.pageId === child.id)) return blocks;
  const last = blocks[blocks.length - 1];
  const block = newPageBlock(child, blockId);
  return last && last.type === 'paragraph' && last.content === '' && !last.indent
    ? [...blocks.slice(0, -1), block]
    : [...blocks, block];
}

/**
 * What moving `id` under `newParentId` (null: to the top) changes: the new blocks of every note that changes, keyed by
 * note id — the old parent loses its page block, the new parent gains one. Null when the move would make a page its
 * own ancestor, or when `id` is not a note.
 */
export function movePage(notes: readonly Pick<Note, 'id' | 'title' | 'blocks'>[], id: string, newParentId: string | null): Record<string, NoteBlock[]> | null {
  const child = notes.find((n) => n.id === id);
  if (!child) return null;
  const parents = parentMap(notes);
  if (wouldCycle(parents, id, newParentId)) return null;
  if (newParentId !== null && !notes.some((n) => n.id === newParentId)) return null;
  // Already there: nothing to change (and its block keeps its place among the parent's lines).
  if ((parents.get(id) ?? null) === newParentId) return {};
  const changes: Record<string, NoteBlock[]> = {};
  for (const note of notes) {
    if (note.id === newParentId) continue;
    const next = withoutPages(note.blocks, new Set([id]));
    if (next !== note.blocks) changes[note.id] = next;
  }
  if (newParentId !== null) {
    const parent = notes.find((n) => n.id === newParentId)!;
    const base = changes[parent.id] ?? parent.blocks;
    const next = withoutPages(base, new Set([id]));
    const withBlock = withPage(next, child);
    if (withBlock !== parent.blocks) changes[parent.id] = withBlock;
  }
  return changes;
}
