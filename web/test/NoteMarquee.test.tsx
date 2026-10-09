import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';

afterEach(() => vi.restoreAllMocks());

const b = (id: string, indent = 0): NoteBlock => ({ id, type: 'todo', content: id, ...(indent ? { indent } : {}) });

function setup(initial: NoteBlock[]) {
  let latest = initial;
  function Editor() {
    const [blocks, setState] = useState(initial);
    return <div data-note-page><NoteEditor
      blocks={blocks}
      onUpdateBlock={vi.fn()} onAddBlock={() => 'x'} onDeleteBlock={vi.fn()} onChangeBlockType={vi.fn()} onMoveBlock={vi.fn()}
      onSetBlocks={(next) => { latest = next; setState(next); }}
      noteId="n"
    /></div>;
  }
  const view = render(<Editor />);
  const root = view.container.querySelector('[tabindex="-1"]') as HTMLElement;
  // Rows are 20px tall and stacked from the top, 400px wide.
  const index = new Map<string, number>();
  view.container.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el, i) => index.set(el.dataset.blockId as string, i));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const i = this.dataset?.blockId ? index.get(this.dataset.blockId) ?? 0 : 0;
    const top = this.dataset?.blockId ? i * 20 : 0;
    return { top, bottom: top + 20, left: 0, right: 400, width: 400, height: 20, x: 0, y: top, toJSON() {} } as DOMRect;
  });
  const chosen = () => [...view.container.querySelectorAll('[data-selected]')].map((n) => (n as HTMLElement).dataset.blockId);
  return { root, blocks: () => latest, chosen, container: view.container };
}

const drag = (from: HTMLElement, a: [number, number], b: [number, number]) => {
  fireEvent.mouseDown(from, { clientX: a[0], clientY: a[1], button: 0 });
  act(() => { fireEvent.mouseMove(document, { clientX: (a[0] + b[0]) / 2, clientY: (a[1] + b[1]) / 2 }); });
  act(() => { fireEvent.mouseMove(document, { clientX: b[0], clientY: b[1] }); });
  act(() => { fireEvent.mouseUp(document, { clientX: b[0], clientY: b[1] }); });
};

describe('dragging a box over blocks to choose them', () => {
  it('chooses every block the box touches, then Backspace deletes them', () => {
    const t = setup([b('a'), b('b'), b('c'), b('d')]);
    // From the blank margin beside row 2 down to row 3.
    drag(t.root, [450, 25], [100, 50]);
    expect(t.chosen()).toEqual(['b', 'c']);
    fireEvent.keyDown(t.root, { key: 'Backspace' });
    expect(t.blocks().map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('a chosen parent brings its children, and a box that reaches nothing chooses nothing', () => {
    const t = setup([b('a'), b('a1', 1), b('z')]);
    drag(t.root, [450, 5], [200, 15]);
    expect(t.chosen()).toEqual(['a', 'a1']);
    drag(t.root, [450, 500], [200, 520]);
    expect(t.chosen()).toEqual([]);
  });

  it('a drag that starts in the text is a text selection, not a box', () => {
    const t = setup([b('a'), b('b'), b('c')]);
    drag(screen.getByDisplayValue('a'), [10, 5], [100, 50]);
    expect(t.chosen()).toEqual([]);
  });

  it('a press that barely moves is a plain click and chooses nothing', () => {
    const t = setup([b('a'), b('b')]);
    drag(t.root, [450, 5], [451, 6]);
    expect(t.chosen()).toEqual([]);
  });
});
