import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';
import { levelOf } from '@/lib/noteBlocks';

const b = (id: string, indent = 0, extra: Partial<NoteBlock> = {}): NoteBlock =>
  ({ id, type: 'todo', content: id, ...(indent ? { indent } : {}), ...extra });

function setup(initial: NoteBlock[], unlink = vi.fn()) {
  let latest = initial;
  function Editor() {
    const [blocks, setState] = useState(initial);
    return <NoteEditor
      blocks={blocks}
      onUpdateBlock={vi.fn()} onAddBlock={() => 'x'} onDeleteBlock={vi.fn()} onChangeBlockType={vi.fn()} onMoveBlock={vi.fn()}
      onSetBlocks={(next) => { latest = next; setState(next); }}
      noteId="n"
      linking={{ lists: [], todos: [], tasksLoaded: true, createTask: async () => null, updateTaskTitle: vi.fn(), unlinkTask: unlink, openTask: vi.fn() } as never}
    />;
  }
  const view = render(<Editor />);
  const root = view.container.querySelector('[tabindex="-1"]') as HTMLElement;
  return { blocks: () => latest, root, selected: () => [...view.container.querySelectorAll('[data-selected]')].map((n) => (n.querySelector('textarea') as HTMLTextAreaElement).value) };
}

const outline = () => [b('a'), b('a1', 1), b('a2', 1), b('b')];

describe('selecting blocks in a note', () => {
  it('Esc chooses the block with its children, and Backspace deletes them all', () => {
    const t = setup(outline());
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    expect(t.selected()).toEqual(['a', 'a1', 'a2']);
    fireEvent.keyDown(t.root, { key: 'Backspace' });
    expect(t.blocks().map((x) => x.id)).toEqual(['b']);
    expect(t.selected()).toEqual([]);
  });

  it('a task linked to a deleted line is let go of, not deleted', () => {
    const unlink = vi.fn();
    const t = setup([b('a', 0, { taskId: 't1' }), b('a1', 1, { taskId: 't2' }), b('b')], unlink);
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    fireEvent.keyDown(t.root, { key: 'Delete' });
    expect(unlink.mock.calls.map((c) => c[0]).sort()).toEqual(['t1', 't2']);
  });

  it('⌘A twice chooses every block, and deleting them leaves one empty paragraph', () => {
    const t = setup(outline());
    const first = screen.getByDisplayValue('a') as HTMLTextAreaElement;
    first.focus();
    first.setSelectionRange(0, first.value.length);
    fireEvent.keyDown(first, { key: 'a', metaKey: true });
    expect(t.selected()).toEqual(['a', 'a1', 'a2', 'b']);
    fireEvent.keyDown(t.root, { key: 'Backspace' });
    expect(t.blocks()).toHaveLength(1);
    expect(t.blocks()[0]).toMatchObject({ type: 'paragraph', content: '' });
  });

  it('⌘A the first time only selects the text, as in any text box', () => {
    const t = setup(outline());
    const first = screen.getByDisplayValue('a') as HTMLTextAreaElement;
    first.focus();
    first.setSelectionRange(0, 0);
    fireEvent.keyDown(first, { key: 'a', metaKey: true });
    expect(t.selected()).toEqual([]);
  });

  it('⌘D copies the group right after itself', () => {
    const t = setup(outline());
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    fireEvent.keyDown(t.root, { key: 'd', metaKey: true });
    expect(t.blocks().map((x) => [x.content, levelOf(x)])).toEqual([
      ['a', 0], ['a1', 1], ['a2', 1], ['a', 0], ['a1', 1], ['a2', 1], ['b', 0],
    ]);
  });

  it('Tab and Shift+Tab nest the chosen block with its children', () => {
    const t = setup([b('x'), b('a'), b('a1', 1), b('b')]);
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    fireEvent.keyDown(t.root, { key: 'Tab' });
    expect(t.blocks().map(levelOf)).toEqual([0, 1, 2, 0]);
    fireEvent.keyDown(t.root, { key: 'Tab', shiftKey: true });
    expect(t.blocks().map(levelOf)).toEqual([0, 0, 1, 0]);
  });

  it('⌘⇧↓ moves the group below its neighbour', () => {
    const t = setup(outline());
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    fireEvent.keyDown(t.root, { key: 'ArrowDown', metaKey: true, shiftKey: true });
    expect(t.blocks().map((x) => x.id)).toEqual(['b', 'a', 'a1', 'a2']);
  });

  it('Shift+click on a grip extends the selection, and a click elsewhere lets go', () => {
    const t = setup([b('a'), b('b'), b('c'), b('d')]);
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    const grips = screen.getAllByRole('button', { name: 'Block options' });
    fireEvent.pointerDown(grips[2], { shiftKey: true });
    expect(t.selected()).toEqual(['a', 'b', 'c']);
    fireEvent.mouseDown(document.body);
    expect(t.selected()).toEqual([]);
  });

  it('arrow keys move the choice, Shift extends it, Esc clears it', () => {
    const t = setup([b('a'), b('b'), b('c')]);
    fireEvent.keyDown(screen.getByDisplayValue('a'), { key: 'Escape' });
    fireEvent.keyDown(t.root, { key: 'ArrowDown' });
    expect(t.selected()).toEqual(['b']);
    fireEvent.keyDown(t.root, { key: 'ArrowDown', shiftKey: true });
    expect(t.selected()).toEqual(['b', 'c']);
    fireEvent.keyDown(t.root, { key: 'Escape' });
    expect(t.selected()).toEqual([]);
  });
});
