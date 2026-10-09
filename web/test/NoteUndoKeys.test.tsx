import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';

const base = { onUpdateBlock: vi.fn(), onAddBlock: () => 'x', onDeleteBlock: vi.fn(), onChangeBlockType: vi.fn(), onMoveBlock: vi.fn() };
const blocks: NoteBlock[] = [{ id: 'a', type: 'paragraph', content: 'hello' }];

describe('undo and redo keys in the editor', () => {
  it('⌘Z undoes for the note and stops the browser undoing one text box', () => {
    const onUndo = vi.fn(() => blocks);
    const onRedo = vi.fn(() => blocks);
    render(<NoteEditor blocks={blocks} {...base} onUndo={onUndo} onRedo={onRedo} />);
    const box = screen.getByDisplayValue('hello');
    expect(fireEvent.keyDown(box, { key: 'z', metaKey: true })).toBe(false);
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: 'z', metaKey: true, shiftKey: true });
    fireEvent.keyDown(box, { key: 'y', ctrlKey: true });
    expect(onRedo).toHaveBeenCalledTimes(2);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('is left to the browser when the editor has no history', () => {
    render(<NoteEditor blocks={blocks} {...base} />);
    expect(fireEvent.keyDown(screen.getByDisplayValue('hello'), { key: 'z', metaKey: true })).toBe(true);
  });

  it('putting a deleted line back puts its task back on it, once, when the task is still free', () => {
    const relink = vi.fn();
    const restored: NoteBlock[] = [{ id: 'a', type: 'todo', content: 'hello', taskId: 't1' }, { id: 'b', type: 'todo', content: 'x', taskId: 't2' }];
    const linking = {
      lists: [], tasksLoaded: true, createTask: async () => null, updateTaskTitle: vi.fn(), unlinkTask: vi.fn(), openTask: vi.fn(), relinkTask: relink,
      todos: [{ id: 't1', text: 'hello' }, { id: 't2', text: 'x', sourceNoteId: 'other' }],
    } as never;
    render(<NoteEditor blocks={blocks} {...base} noteId="n" linking={linking} onUndo={() => restored} />);
    fireEvent.keyDown(screen.getByDisplayValue('hello'), { key: 'z', metaKey: true });
    expect(relink).toHaveBeenCalledTimes(1);
    expect(relink).toHaveBeenCalledWith('t1', { noteId: 'n', blockId: 'a' });
  });
});
