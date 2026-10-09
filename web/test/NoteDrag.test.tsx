import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';
import { levelOf } from '@/lib/noteBlocks';

// jsdom has no PointerEvent; the drag library needs `isPrimary`, `button` and the coordinates.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    isPrimary: boolean;
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.isPrimary = init.isPrimary ?? false;
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true });
}

const b = (id: string, indent = 0): NoteBlock => ({ id, type: 'todo', content: id, ...(indent ? { indent } : {}) });

afterEach(() => vi.restoreAllMocks());

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
  // Rows are 20px tall, stacked from the top, so the pointer's height means something in jsdom.
  const rects = new Map<string, number>();
  view.container.querySelectorAll<HTMLElement>('[data-block-id]').forEach((el, i) => rects.set(el.dataset.blockId as string, i * 20));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.dataset?.blockId ? rects.get(this.dataset.blockId) ?? 0 : 0;
    return { top, bottom: top + (this.dataset?.blockId ? 20 : 400), left: 0, right: 500, width: 500, height: 20, x: 0, y: top, toJSON() {} } as DOMRect;
  });
  return { blocks: () => latest };
}

function drag(grip: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, extra: Record<string, unknown> = {}) {
  fireEvent.pointerDown(grip, { clientX: from.x, clientY: from.y, button: 0, isPrimary: true, pointerId: 1, ...extra });
  // The first move past the threshold starts the drag; the next ones move it, as a real pointer produces.
  for (const step of [0.5, 1]) {
    act(() => { fireEvent.pointerMove(document, { clientX: from.x + (to.x - from.x) * step, clientY: from.y + (to.y - from.y) * step, isPrimary: true, pointerId: 1 }); });
  }
  act(() => { fireEvent.pointerUp(document, { clientX: to.x, clientY: to.y, isPrimary: true, pointerId: 1 }); });
}

describe('dragging a block by its grip', () => {
  it('moves a parent with its children below another block', () => {
    const t = setup([b('a'), b('a1', 1), b('b'), b('c')]);
    const grips = screen.getAllByRole('button', { name: 'Block options' });
    drag(grips[0], { x: 5, y: 10 }, { x: 5, y: 55 });
    expect(t.blocks().map((x) => [x.id, levelOf(x)])).toEqual([['b', 0], ['a', 0], ['a1', 1], ['c', 0]]);
  });

  it('dragging right nests the group under the block above the drop', () => {
    const t = setup([b('a'), b('b'), b('c')]);
    const grips = screen.getAllByRole('button', { name: 'Block options' });
    drag(grips[2], { x: 5, y: 50 }, { x: 40, y: 50 });
    expect(t.blocks().map((x) => [x.id, levelOf(x)])).toEqual([['a', 0], ['b', 0], ['c', 1]]);
  });

  it('a press that does not move is not a drag', () => {
    const t = setup([b('a'), b('b')]);
    const grips = screen.getAllByRole('button', { name: 'Block options' });
    drag(grips[0], { x: 5, y: 10 }, { x: 5, y: 13 });
    expect(t.blocks().map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('holding Option as the drag begins leaves the original and places a copy', () => {
    const t = setup([b('a'), b('a1', 1), b('b')]);
    const grips = screen.getAllByRole('button', { name: 'Block options' });
    drag(grips[0], { x: 5, y: 10 }, { x: 5, y: 55 }, { altKey: true });
    expect(t.blocks().map((x) => [x.content, levelOf(x)])).toEqual([['a', 0], ['a1', 1], ['b', 0], ['a', 0], ['a1', 1]]);
    expect(new Set(t.blocks().map((x) => x.id)).size).toBe(5);
  });

  it('dropping a group on its own children changes nothing', () => {
    const t = setup([b('a'), b('a1', 1), b('a2', 1), b('b')]);
    const grips = screen.getAllByRole('button', { name: 'Block options' });
    drag(grips[0], { x: 5, y: 10 }, { x: 5, y: 30 });
    expect(t.blocks().map((x) => x.id)).toEqual(['a', 'a1', 'a2', 'b']);
  });
});
