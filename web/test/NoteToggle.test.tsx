import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteEditor } from '@/components/NoteEditor';
import { hiddenBlockIds, indentBlock, insertIndexAfter, levelForNewBlockAfter, levelOf, outdentBlock, toggleHasChildren } from '@/lib/noteBlocks';
import type { BlockType, NoteBlock } from '@/types/notes';

const b = (id: string, content: string, type: BlockType = 'paragraph', indent = 0, extra: Partial<NoteBlock> = {}): NoteBlock =>
  ({ id, type, content, ...(indent ? { indent } : {}), ...extra });

describe('toggle helpers', () => {
  const tree = [
    b('gp', 'grand parent', 'toggle'),
    b('p', 'parent', 'toggle', 1),
    b('mom', 'mom', 'toggle', 2, { collapsed: true }),
    b('momKid', 'mom', 'paragraph', 3),
    b('dad', 'dad', 'toggle', 2),
    b('dadKid', 'dad', 'paragraph', 3),
    b('after', 'after', 'paragraph'),
  ];

  it('hides only what sits inside a closed toggle, at any depth', () => {
    expect([...hiddenBlockIds(tree)]).toEqual(['momKid']);
    const closedTop = tree.map((x) => (x.id === 'gp' ? { ...x, collapsed: true } : x));
    expect([...hiddenBlockIds(closedTop)].sort()).toEqual(['dad', 'dadKid', 'mom', 'momKid', 'p']);
  });

  it('an open toggle takes a new line inside; a closed one gets a sibling after everything it holds', () => {
    expect(levelForNewBlockAfter(tree, 3 - 1 - 1)).toBe(2); // parent, open: first child at level 2
    expect(levelForNewBlockAfter(tree, 2)).toBe(2);         // mom, closed: a sibling
    expect(insertIndexAfter(tree, 2)).toBe(4);              // after momKid
    expect(insertIndexAfter(tree, 4)).toBe(5);              // dad, open: straight after
  });

  it('knows whether a toggle holds anything', () => {
    expect(toggleHasChildren(tree, 4)).toBe(true);
    expect(toggleHasChildren([b('t', 'empty', 'toggle'), b('n', 'next')], 0)).toBe(false);
  });

  it('Tab nests a line under a toggle and Shift+Tab brings it out, like any other block', () => {
    const list = [b('t', 'toggle', 'toggle'), b('c', 'child')];
    const inside = indentBlock(list, 'c');
    expect(inside.map(levelOf)).toEqual([0, 1]);
    expect(outdentBlock(inside, 'c').map(levelOf)).toEqual([0, 0]);
  });
});

let n = 0;
function Editor({ initial, onBlocks }: { initial: NoteBlock[]; onBlocks: (x: NoteBlock[]) => void }) {
  const [blocks, setState] = useState(initial);
  const set = (fn: (x: NoteBlock[]) => NoteBlock[]) => setState((cur) => { const out = fn(cur); onBlocks(out); return out; });
  return <NoteEditor
    blocks={blocks}
    onUpdateBlock={(id, changes) => set((cur) => cur.map((x) => (x.id === id ? { ...x, ...changes } : x)))}
    onAddBlock={(after, type = 'paragraph') => {
      const id = `new-${n++}`;
      set((cur) => {
        const i = cur.findIndex((x) => x.id === after);
        const level = levelForNewBlockAfter(cur, i);
        const at = insertIndexAfter(cur, i);
        const created: NoteBlock = { id, type, content: '', ...(level ? { indent: level } : {}) };
        return [...cur.slice(0, at), created, ...cur.slice(at)];
      });
      return id;
    }}
    onDeleteBlock={(id) => set((cur) => cur.filter((x) => x.id !== id))}
    onChangeBlockType={(id, type) => set((cur) => cur.map((x) => (x.id === id ? { ...x, type } : x)))}
    onMoveBlock={vi.fn()}
    onSetIndent={(id, dir) => set((cur) => (dir === 'in' ? indentBlock(cur, id) : outdentBlock(cur, id)))}
  />;
}

function setup(initial: NoteBlock[]) {
  let latest = initial;
  render(<Editor initial={initial} onBlocks={(x) => { latest = x; }} />);
  return { blocks: () => latest };
}

describe('toggle blocks in the editor', () => {
  it('shows the arrow, hides what is inside when closed, and shows it again when opened', () => {
    const t = setup([b('t', 'Parent', 'toggle'), b('c', 'Inside', 'paragraph', 1)]);
    expect(screen.getByDisplayValue('Inside')).toBeInTheDocument();
    const arrow = screen.getByRole('button', { name: 'Close toggle' });
    expect(arrow).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(arrow);
    expect(t.blocks()[0].collapsed).toBe(true);
    expect(screen.queryByDisplayValue('Inside')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open toggle' }));
    expect(screen.getByDisplayValue('Inside')).toBeInTheDocument();
  });

  it('an open toggle with nothing inside says so, and a click puts a line inside it', () => {
    const t = setup([b('t', 'Empty one', 'toggle')]);
    fireEvent.click(screen.getByText('Empty toggle. Click or drop blocks inside.'));
    expect(t.blocks().map(levelOf)).toEqual([0, 1]);
    expect(screen.queryByText('Empty toggle. Click or drop blocks inside.')).toBeNull();
  });

  it('Enter in an open toggle starts its first inner line; in a closed one it adds a line after the whole toggle', () => {
    const open = setup([b('t', 'Open', 'toggle'), b('x', 'after')]);
    fireEvent.keyDown(screen.getByDisplayValue('Open'), { key: 'Enter' });
    expect(open.blocks().map((x) => [x.content, levelOf(x)])).toEqual([['Open', 0], ['', 1], ['after', 0]]);
  });

  it('Enter in a closed toggle goes after everything hidden inside it', () => {
    const t = setup([b('t', 'Closed', 'toggle', 0, { collapsed: true }), b('h', 'hidden', 'paragraph', 1), b('x', 'after')]);
    fireEvent.keyDown(screen.getByDisplayValue('Closed'), { key: 'Enter' });
    expect(t.blocks().map((x) => [x.content, levelOf(x)])).toEqual([['Closed', 0], ['hidden', 1], ['', 0], ['after', 0]]);
  });

  it('arrow keys skip the lines hidden inside a closed toggle', () => {
    setup([b('t', 'Closed', 'toggle', 0, { collapsed: true }), b('h', 'hidden', 'paragraph', 1), b('x', 'after')]);
    const closed = screen.getByDisplayValue('Closed') as HTMLTextAreaElement;
    closed.focus();
    closed.setSelectionRange(closed.value.length, closed.value.length);
    fireEvent.keyDown(closed, { key: 'ArrowDown' });
    expect(screen.queryByDisplayValue('hidden')).toBeNull();
    expect(screen.getByDisplayValue('after')).toBeInTheDocument();
  });

  it('⌘/Ctrl+Enter opens or closes the toggle on the line', () => {
    const t = setup([b('t', 'T', 'toggle'), b('c', 'kid', 'paragraph', 1)]);
    fireEvent.keyDown(screen.getByDisplayValue('T'), { key: 'Enter', ctrlKey: true });
    expect(t.blocks()[0].collapsed).toBe(true);
  });
});
