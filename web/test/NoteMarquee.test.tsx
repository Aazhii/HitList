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
      onUpdateBlock={vi.fn()}
      onAddBlock={(after) => {
        const id = `new-${latest.length}`;
        const i = latest.findIndex((x) => x.id === after);
        latest = [...latest.slice(0, i + 1), { id, type: 'paragraph', content: '' }, ...latest.slice(i + 1)];
        setState(latest);
        return id;
      }}
      onDeleteBlock={vi.fn()} onChangeBlockType={vi.fn()} onMoveBlock={vi.fn()}
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

  it('a drag that stays inside one line is a text selection, not a choice of blocks', () => {
    const t = setup([b('a'), b('b'), b('c')]);
    drag(screen.getByDisplayValue('a'), [10, 5], [100, 12]);
    expect(t.chosen()).toEqual([]);
  });

  it('a press that barely moves is a plain click and chooses nothing', () => {
    const t = setup([b('a'), b('b')]);
    drag(t.root, [450, 5], [451, 6]);
    expect(t.chosen()).toEqual([]);
  });
});

describe('dragging through text into the next lines', () => {
  it('turns into a choice of every line from where it began to where it is, and Backspace deletes them', () => {
    const t = setup([b('a'), b('b'), b('c'), b('d')]);
    drag(screen.getByDisplayValue('b'), [10, 25], [100, 50]);
    expect(t.chosen()).toEqual(['b', 'c']);
    fireEvent.keyDown(t.root, { key: 'Backspace' });
    expect(t.blocks().map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('works upwards too, and follows the pointer back', () => {
    const t = setup([b('a'), b('b'), b('c'), b('d')]);
    const from = screen.getByDisplayValue('c');
    fireEvent.mouseDown(from, { clientX: 10, clientY: 45, button: 0 });
    act(() => { fireEvent.mouseMove(document, { clientX: 20, clientY: 5 }); });
    expect(t.chosen()).toEqual(['a', 'b', 'c']);
    act(() => { fireEvent.mouseMove(document, { clientX: 20, clientY: 30 }); });
    expect(t.chosen()).toEqual(['b', 'c']);
    act(() => { fireEvent.mouseUp(document); });
  });

  it('brings the children of a chosen parent along', () => {
    const t = setup([b('a'), b('a1', 1), b('z')]);
    drag(screen.getByDisplayValue('z'), [10, 45], [100, 5]);
    expect(t.chosen()).toEqual(['a', 'a1', 'z']);
  });

  it('a click or a press with a modifier does not start it', () => {
    const t = setup([b('a'), b('b')]);
    fireEvent.mouseDown(screen.getByDisplayValue('a'), { clientX: 10, clientY: 5, button: 0, shiftKey: true });
    act(() => { fireEvent.mouseMove(document, { clientX: 10, clientY: 30 }); });
    expect(t.chosen()).toEqual([]);
  });
});

describe('clicking empty space puts the caret where you would expect', () => {
  const click = (target: HTMLElement, x: number, y: number) => {
    fireEvent.mouseDown(target, { clientX: x, clientY: y, button: 0 });
    act(() => { fireEvent.mouseUp(document, { clientX: x, clientY: y }); });
  };
  const para = (id: string, content = ''): NoteBlock => ({ id, type: 'paragraph', content });

  it('below an empty last line it goes into that line (no new line is added)', () => {
    const t = setup([para('a', 'text'), para('z', '')]);
    click(t.root, 450, 300);
    expect(document.activeElement).toBe(screen.getAllByRole('textbox')[1]);
    expect(t.blocks()).toHaveLength(2);
  });

  it('below a last line that has text it adds a new empty line and goes into it', async () => {
    const t = setup([para('a', 'text'), para('z', 'last words')]);
    click(t.root, 450, 300);
    expect(t.blocks().map((x) => x.id)).toEqual(['a', 'z', 'new-2']);
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('textbox')[2]));
  });

  it('beside or between lines it goes to the nearest one, at the end of its text', () => {
    const t = setup([para('a', 'first'), para('b', 'second'), para('c', 'third')]);
    click(t.root, 450, 30); // the blank right-hand side of the second row
    const second = screen.getByDisplayValue('second') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(second);
    expect(second.selectionStart).toBe('second'.length);
  });

  it('above the first line does nothing', () => {
    setup([para('a', 'first'), para('b', 'second')]);
    click(document.body, 450, -30);
    expect(document.activeElement).toBe(document.body);
  });

  it('a click that lands on a line\'s own text is left to the text box', () => {
    const t = setup([para('a', 'first'), para('b', 'second')]);
    const box = screen.getByDisplayValue('first');
    click(box, 10, 5);
    // not taken over: nothing was added or chosen
    expect(t.blocks()).toHaveLength(2);
    expect(t.chosen()).toEqual([]);
  });
});
