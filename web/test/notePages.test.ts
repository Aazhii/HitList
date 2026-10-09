import { describe, it, expect } from 'vitest';
import type { NoteBlock } from '@/types/notes';
import {
  ancestorsOf, childrenOf, descendantsOf, movePage, newPageBlock, pageTargets, parentMap, treeRows, withPage, withoutPages, wouldCycle,
} from '@/lib/notePages';

const page = (pageId: string, id = `pb-${pageId}`): NoteBlock => ({ id, type: 'page', content: pageId, pageId });
const text = (content: string): NoteBlock => ({ id: `t-${content}`, type: 'paragraph', content });
const note = (id: string, ...blocks: NoteBlock[]) => ({ id, title: id.toUpperCase(), blocks: blocks.length ? blocks : [text('')] });

// root ─ a ─ a1
//      │   └ a2
//      └ b          c (top level, holds nothing)
const notes = () => [note('root', page('a'), page('b')), note('a', page('a1'), text('x'), page('a2')), note('a1'), note('a2'), note('b'), note('c')];

describe('the page tree', () => {
  it('a note\'s parent is the note that holds a page block pointing at it', () => {
    const parents = parentMap(notes());
    expect(Object.fromEntries(parents)).toEqual({ a: 'root', b: 'root', a1: 'a', a2: 'a' });
    expect(pageTargets(note('a', page('a1'), page('a1'), page('a2')))).toEqual(['a1', 'a2']);
  });

  it('children keep the order they have in the parent, and ancestors run from the top down', () => {
    const l = notes(); const parents = parentMap(l);
    expect(childrenOf(l, parents, 'a')).toEqual(['a1', 'a2']);
    expect(childrenOf(l, parents, 'root')).toEqual(['a', 'b']);
    expect(ancestorsOf(parents, 'a2')).toEqual(['root', 'a']);
    expect(ancestorsOf(parents, 'root')).toEqual([]);
    expect(descendantsOf(l, parents, 'root')).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('ignores a block that points at a missing note or at itself, and the first parent wins', () => {
    const l = [note('p', page('ghost'), page('p'), page('k')), note('q', page('k')), note('k')];
    expect(Object.fromEntries(parentMap(l))).toEqual({ k: 'p' });
  });

  it('cuts a cycle instead of looping', () => {
    const l = [note('x', page('y')), note('y', page('x'))];
    const parents = parentMap(l);
    expect(parents.get('y')).toBe('x');
    expect(parents.has('x')).toBe(false);
    expect(treeRows(l, parents, new Set(['x', 'y'])).map((r) => r.note.id)).toEqual(['x', 'y']);
  });

  it('a page cannot be moved under itself or under something inside it', () => {
    const parents = parentMap(notes());
    expect(wouldCycle(parents, 'a', 'a')).toBe(true);
    expect(wouldCycle(parents, 'a', 'a1')).toBe(true);
    expect(wouldCycle(parents, 'a', 'b')).toBe(false);
    expect(wouldCycle(parents, 'a', null)).toBe(false);
  });
});

describe('treeRows', () => {
  it('lists top-level pages with their open sub-pages beneath', () => {
    const l = notes(); const parents = parentMap(l);
    const closed = treeRows(l, parents, new Set());
    expect(closed.map((r) => [r.note.id, r.depth, r.hasChildren, r.expanded])).toEqual([['root', 0, true, false], ['c', 0, false, false]]);
    const open = treeRows(l, parents, new Set(['root', 'a']));
    expect(open.map((r) => `${'-'.repeat(r.depth)}${r.note.id}`)).toEqual(['root', '-a', '--a1', '--a2', '-b', 'c']);
  });
});

describe('editing the tree', () => {
  it('adds a page block for a child, using up an empty last line', () => {
    const child = { id: 'k', title: 'Kid' };
    const a = withPage([text('hi'), text('')], child, 'b1');
    expect(a.map((x) => x.type)).toEqual(['paragraph', 'page']);
    expect(a[1]).toMatchObject({ id: 'b1', pageId: 'k', content: 'Kid' });
    expect(withPage([text('hi'), text('more')], child).map((x) => x.type)).toEqual(['paragraph', 'paragraph', 'page']);
    expect(withPage(a, child)).toBe(a);
    expect(newPageBlock({ id: 'z', title: '' }).content).toBe('Untitled');
  });

  it('removes only the page blocks that point at the given pages', () => {
    const blocks = [page('a'), page('b'), text('keep')];
    expect(withoutPages(blocks, new Set(['a'])).map((x) => x.pageId ?? x.content)).toEqual(['b', 'keep']);
    expect(withoutPages(blocks, new Set(['zzz']))).toBe(blocks);
  });

  it('moving a page changes its old parent and its new parent, and nothing else', () => {
    const changes = movePage(notes(), 'a1', 'b')!;
    expect(Object.keys(changes).sort()).toEqual(['a', 'b']);
    expect(changes.a.some((x) => x.pageId === 'a1')).toBe(false);
    expect(changes.a.some((x) => x.pageId === 'a2')).toBe(true);
    expect(changes.b.some((x) => x.pageId === 'a1')).toBe(true);
  });

  it('moving to the top only removes the link', () => {
    const changes = movePage(notes(), 'a', null)!;
    expect(Object.keys(changes)).toEqual(['root']);
    expect(changes.root.map((x) => x.pageId)).toEqual(['b']);
  });

  it('refuses a move that would make a page its own ancestor, or an unknown target', () => {
    expect(movePage(notes(), 'a', 'a1')).toBeNull();
    expect(movePage(notes(), 'a', 'a')).toBeNull();
    expect(movePage(notes(), 'nope', 'b')).toBeNull();
    expect(movePage(notes(), 'a', 'nope')).toBeNull();
  });

  it('moving under the page it is already in changes nothing', () => {
    expect(movePage(notes(), 'a', 'root')).toEqual({});
  });
});
