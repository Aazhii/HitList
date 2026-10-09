import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';

const b = (id: string, content: string, indent = 0, extra: Partial<NoteBlock> = {}): NoteBlock =>
  ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}), ...extra });

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
  const marks = () => [...view.container.querySelectorAll('[data-find]')].map((n) => `${(n as HTMLElement).dataset.blockId}:${(n as HTMLElement).dataset.find}`);
  return { blocks: () => latest, marks };
}

const openFind = () => {
  act(() => { fireEvent.keyDown(document, { key: 'f', metaKey: true }); });
  return screen.getByRole('textbox', { name: 'Find in note' });
};
const list = () => [b('a', 'Customer remark'), b('b', 'nothing'), b('c', 'a remark and another REMARK')];

describe('find in a note', () => {
  it('⌘F opens the bar, which counts matches and marks the blocks that hold them', () => {
    const t = setup(list());
    expect(screen.queryByRole('search')).toBeNull();
    const input = openFind();
    fireEvent.change(input, { target: { value: 'remark' } });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(t.marks()).toEqual(['a:current', 'c:match']);
  });

  it('Enter goes to the next match, Shift+Enter the previous, both wrapping round', () => {
    const t = setup(list());
    const input = openFind();
    fireEvent.change(input, { target: { value: 'remark' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(t.marks()).toEqual(['a:match', 'c:current']);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
  });

  it('says when nothing matches, and match case narrows it', () => {
    setup(list());
    const input = openFind();
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No results')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'REMARK' } });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });

  it('opens a closed toggle that hides the match', () => {
    const t = setup([b('t', 'Group', 0, { type: 'toggle', collapsed: true }), b('k', 'secret thing', 1)]);
    expect(screen.queryByDisplayValue('secret thing')).toBeNull();
    const input = openFind();
    fireEvent.change(input, { target: { value: 'secret' } });
    expect(t.blocks()[0].collapsed).toBeUndefined();
    expect(screen.getByDisplayValue('secret thing')).toBeInTheDocument();
  });

  it('Esc closes the bar and clears the marks; the text is untouched', () => {
    const t = setup(list());
    const input = openFind();
    fireEvent.change(input, { target: { value: 'remark' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('search')).toBeNull();
    expect(t.marks()).toEqual([]);
    expect(t.blocks().map((x) => x.content)).toEqual(list().map((x) => x.content));
  });
});
