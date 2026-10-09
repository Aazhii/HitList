import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';
import { levelOf } from '@/lib/noteBlocks';
import { BLOCKS_MIME } from '@/lib/noteClipboard';

const b = (id: string, indent = 0, extra: Partial<NoteBlock> = {}): NoteBlock =>
  ({ id, type: 'todo', content: id, ...(indent ? { indent } : {}), ...extra });

function setup(initial: NoteBlock[]) {
  let latest = initial;
  function Editor() {
    const [blocks, setState] = useState(initial);
    return <NoteEditor
      blocks={blocks}
      onUpdateBlock={vi.fn()} onAddBlock={() => 'x'} onDeleteBlock={vi.fn()} onChangeBlockType={vi.fn()} onMoveBlock={vi.fn()}
      onSetBlocks={(next) => { latest = next; setState(next); }}
      noteId="n"
    />;
  }
  const view = render(<Editor />);
  const root = view.container.querySelector('[tabindex="-1"]') as HTMLElement;
  return { blocks: () => latest, root, container: view.container };
}

const clipboard = (data: Record<string, string> = {}) => {
  const store = { ...data };
  return { store, clipboardData: { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k] ?? '', types: Object.keys(store) } };
};
const outline = () => [b('a'), b('a1', 1), b('a2', 1), b('b')];

describe('copy, cut and paste of chosen blocks', () => {
  it('copies a parent with its children as blocks and as indented text', () => {
    const t = setup(outline());
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    const c = clipboard();
    fireEvent.copy(t.root, c);
    expect(c.store['text/plain']).toBe('[ ] a\n  [ ] a1\n  [ ] a2');
    expect(JSON.parse(c.store[BLOCKS_MIME]).map((x: NoteBlock) => x.id)).toEqual(['a', 'a1', 'a2']);
    expect(t.blocks()).toHaveLength(4);
  });

  it('cut also removes them', () => {
    const t = setup(outline());
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    const c = clipboard();
    fireEvent.cut(t.root, c);
    expect(c.store[BLOCKS_MIME]).toBeTruthy();
    expect(t.blocks().map((x) => x.id)).toEqual(['b']);
  });

  it('pastes copied blocks after the chosen group, nesting kept, new ids', () => {
    const t = setup(outline());
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    const c = clipboard();
    fireEvent.copy(t.root, c);
    fireEvent.keyDown(t.root, { key: 'Escape' });
    fireEvent.keyDown(screen.getByDisplayValue('b'), { key: 'Escape' });
    fireEvent.paste(t.root, clipboard(c.store));
    expect(t.blocks().map((x) => [x.content, levelOf(x)])).toEqual([
      ['a', 0], ['a1', 1], ['a2', 1], ['b', 0], ['a', 0], ['a1', 1], ['a2', 1],
    ]);
    expect(new Set(t.blocks().map((x) => x.id)).size).toBe(7);
  });

  it('pastes into a text box as blocks only for our own format; plain text pastes as it always did', () => {
    const t = setup([b('a'), b('b')]);
    const box = screen.getByDisplayValue('a');
    const plain = clipboard({ 'text/plain': 'hello' });
    expect(fireEvent.paste(box, plain)).toBe(true);
    expect(t.blocks()).toHaveLength(2);
    const ours = clipboard({ [BLOCKS_MIME]: JSON.stringify([{ type: 'todo', content: 'pasted' }]) });
    expect(fireEvent.paste(box, ours)).toBe(false);
    expect(t.blocks().map((x) => x.content)).toEqual(['a', 'pasted', 'b']);
  });

  it('refuses a paste that is not valid blocks and leaves the note alone', () => {
    const t = setup([b('a')]);
    fireEvent.paste(screen.getByDisplayValue('a'), clipboard({ [BLOCKS_MIME]: '{"evil":true}' }));
    expect(t.blocks()).toHaveLength(1);
  });
});

describe('other multi-block actions', () => {
  it('turns several chosen blocks into another kind from the grip menu, leaving their children', () => {
    const t = setup([b('a'), b('a1', 1), b('b')]);
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    const grips = () => screen.getAllByRole('button', { name: 'Block options' });
    fireEvent.pointerDown(grips()[2], { metaKey: true });
    fireEvent.click(grips()[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: /bullet/i }));
    expect(t.blocks().map((x) => [x.id, x.type])).toEqual([['a', 'bullet'], ['a1', 'todo'], ['b', 'bullet']]);
  });

  it('⌘⌥T closes every toggle that holds something, and opens them again', () => {
    const t = setup([b('t', 0, { type: 'toggle' }), b('k', 1, { type: 'paragraph' })]);
    fireEvent.keyDown(screen.getByDisplayValue('t'), { key: '†', code: 'KeyT', metaKey: true, altKey: true });
    expect(t.blocks()[0].collapsed).toBe(true);
    fireEvent.keyDown(t.root, { key: '†', code: 'KeyT', metaKey: true, altKey: true });
    expect(t.blocks()[0].collapsed).toBeUndefined();
  });

  it('draws a guide line down the left of nested blocks only', () => {
    const t = setup([b('a'), b('a1', 1), b('a2', 2)]);
    const rows = [...t.container.querySelectorAll('[data-block-id]')];
    expect(rows.map((r) => r.querySelectorAll('span[aria-hidden].pointer-events-none').length)).toEqual([0, 1, 2]);
  });
});
