import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteEditor } from '@/components/NoteEditor';
import { indentBlock, levelForNewBlockAfter, levelOf, outdentBlock } from '@/lib/noteBlocks';
import type { BlockType, NoteBlock } from '@/types/notes';

let next = 0;
/** The editor wired the way useNotes wires it, over local state. */
function Editor({ initial, onBlocks }: { initial: NoteBlock[]; onBlocks: (blocks: NoteBlock[]) => void }) {
  const [blocks, setBlocksState] = useState(initial);
  const setBlocks = (fn: (b: NoteBlock[]) => NoteBlock[]) => setBlocksState((cur) => { const out = fn(cur); onBlocks(out); return out; });
  return <NoteEditor
    blocks={blocks}
    onUpdateBlock={(id, changes) => setBlocks((cur) => cur.map((b) => (b.id === id ? { ...b, ...changes } : b)))}
    onAddBlock={(after, type = 'paragraph') => {
      const id = `new-${next++}`;
      setBlocks((cur) => {
        const i = cur.findIndex((b) => b.id === after);
        const level = levelForNewBlockAfter(cur, i);
        const block: NoteBlock = { id, type, content: '', ...(level ? { indent: level } : {}) };
        return [...cur.slice(0, i + 1), block, ...cur.slice(i + 1)];
      });
      return id;
    }}
    onDeleteBlock={(id) => setBlocks((cur) => cur.filter((b) => b.id !== id))}
    onChangeBlockType={(id, type: BlockType) => setBlocks((cur) => cur.map((b) => (b.id === id ? { ...b, type } : b)))}
    onMoveBlock={vi.fn()}
    onSetIndent={(id, dir) => setBlocks((cur) => (dir === 'in' ? indentBlock(cur, id) : outdentBlock(cur, id)))}
  />;
}

const para = (id: string, content = '', indent = 0, type: BlockType = 'paragraph'): NoteBlock => ({ id, type, content, ...(indent ? { indent } : {}) });

function setup(initial: NoteBlock[]) {
  let latest = initial;
  render(<Editor initial={initial} onBlocks={(b) => { latest = b; }} />);
  return { blocks: () => latest, inputs: () => screen.getAllByRole('textbox') };
}

describe('Tab and Shift+Tab in a note', () => {
  it('pushes a line in under the one above and shows it indented', () => {
    const t = setup([para('a', 'First'), para('b', 'Second')]);
    const second = t.inputs()[1];
    fireEvent.keyDown(second, { key: 'Tab' });
    expect(t.blocks().map(levelOf)).toEqual([0, 1]);
    expect(second.closest('[style*="margin-left"]')).toHaveStyle({ marginLeft: '24px' });
  });

  it('does nothing on the first line, and never goes more than one level deeper than the line above', () => {
    const t = setup([para('a', 'First'), para('b', 'Second')]);
    fireEvent.keyDown(t.inputs()[0], { key: 'Tab' });
    expect(t.blocks().map(levelOf)).toEqual([0, 0]);
    fireEvent.keyDown(t.inputs()[1], { key: 'Tab' });
    fireEvent.keyDown(t.inputs()[1], { key: 'Tab' });
    expect(t.blocks().map(levelOf)).toEqual([0, 1]);
  });

  it('Shift+Tab brings the line back out', () => {
    const t = setup([para('a', 'First'), para('b', 'Second', 1)]);
    fireEvent.keyDown(t.inputs()[1], { key: 'Tab', shiftKey: true });
    expect(t.blocks().map(levelOf)).toEqual([0, 0]);
  });

  it('indents to-dos and headings like any other line, three levels deep', () => {
    const t = setup([para('a', 'one', 0, 'todo'), para('b', 'two', 0, 'todo'), para('c', 'three', 0, 'todo'), para('h', 'heading', 0, 'heading2')]);
    fireEvent.keyDown(t.inputs()[1], { key: 'Tab' });
    fireEvent.keyDown(t.inputs()[2], { key: 'Tab' });
    fireEvent.keyDown(t.inputs()[2], { key: 'Tab' });
    fireEvent.keyDown(t.inputs()[3], { key: 'Tab' });
    expect(t.blocks().map(levelOf)).toEqual([0, 1, 2, 1]);
    expect(t.blocks()[3].type).toBe('heading2');
  });

  it('a code block is the code editor, not a text box: it takes Tab itself and the line is never nested', async () => {
    const t = setup([para('a', 'x'), para('c', 'if (a)', 0, 'code')]);
    // Only the plain line is a text box; the code block is rendered by the code editor (loaded on demand).
    expect(t.inputs()).toHaveLength(1);
    await waitFor(() => expect(document.querySelector('[data-code-block] .cm-editor')).not.toBeNull());
    expect(t.blocks()[1].content).toBe('if (a)');
    expect(levelOf(t.blocks()[1])).toBe(0);
  });

  it('with the slash menu open, Tab picks the highlighted block type instead of indenting', () => {
    const t = setup([para('a', 'First'), para('b', '')]);
    const second = t.inputs()[1];
    fireEvent.change(second, { target: { value: '/' } });
    fireEvent.change(second, { target: { value: '/h2' } });
    fireEvent.keyDown(second, { key: 'Tab' });
    expect(levelOf(t.blocks()[1])).toBe(0);
    expect(t.blocks()[1].type).toBe('heading2');
  });
});

describe('Enter and Backspace on an indented line', () => {
  it('Enter on an empty nested to-do steps it back out one level', () => {
    const t = setup([para('a', 'one', 0, 'todo'), para('b', '', 1, 'todo')]);
    fireEvent.keyDown(t.inputs()[1], { key: 'Enter' });
    expect(t.blocks().map(levelOf)).toEqual([0, 0]);
    expect(t.blocks()[1].type).toBe('todo');
  });

  it('Enter on an empty top-level bullet ends the list as plain text', () => {
    const t = setup([para('a', 'one', 0, 'bullet'), para('b', '', 0, 'bullet')]);
    fireEvent.keyDown(t.inputs()[1], { key: 'Enter' });
    expect(t.blocks()).toHaveLength(2);
    expect(t.blocks()[1].type).toBe('paragraph');
  });

  it('Enter on a filled nested item starts a new item at the same level', () => {
    const t = setup([para('a', 'one', 0, 'todo'), para('b', 'two', 1, 'todo')]);
    fireEvent.keyDown(t.inputs()[1], { key: 'Enter' });
    expect(t.blocks().map(levelOf)).toEqual([0, 1, 1]);
    expect(t.blocks()[2].type).toBe('todo');
  });

  it('Backspace at the start of an indented line brings it out first and does not delete it', () => {
    const t = setup([para('a', 'one'), para('b', '', 1)]);
    const second = t.inputs()[1];
    fireEvent.keyDown(second, { key: 'Backspace' });
    expect(t.blocks().map(levelOf)).toEqual([0, 0]);
    expect(t.blocks()).toHaveLength(2);
    fireEvent.keyDown(t.inputs()[1], { key: 'Backspace' });
    expect(t.blocks()).toHaveLength(1);
  });
});
