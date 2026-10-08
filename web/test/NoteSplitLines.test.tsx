import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';

const pasted = '"type": "SingleLine", "label": "Customer Remark",\n   "api_name": "Customer_Remark",\n   "length": 255,\n   "required": false';

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
        return [...cur.slice(0, i + 1), { id, type, content: '' }, ...cur.slice(i + 1)];
      });
      return id;
    }}
    onDeleteBlock={vi.fn()}
    onChangeBlockType={vi.fn()}
    onMoveBlock={vi.fn()}
  />;
}

describe('Split lines', () => {
  it('turns each selected line of a pasted list item into its own item of the same type', () => {
    let latest: NoteBlock[] = [];
    render(<Editor initial={[{ id: 'a', type: 'numbered', content: pasted }]} onBlocks={(x) => { latest = x; }} />);
    const ta = screen.getByDisplayValue(/"type": "SingleLine"/) as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, pasted.length);
    fireEvent.select(ta);
    fireEvent.mouseDown(screen.getByRole('button', { name: /split lines/i }));
    expect(latest.map((b) => [b.type, b.content])).toEqual([
      ['numbered', '"type": "SingleLine", "label": "Customer Remark",'],
      ['numbered', '"api_name": "Customer_Remark",'],
      ['numbered', '"length": 255,'],
      ['numbered', '"required": false'],
    ]);
  });

  it('is not offered for a selection inside one line', () => {
    render(<Editor initial={[{ id: 'a', type: 'numbered', content: pasted }]} onBlocks={() => {}} />);
    const ta = screen.getByDisplayValue(/"type": "SingleLine"/) as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 10);
    fireEvent.select(ta);
    expect(screen.queryByRole('button', { name: /split lines/i })).toBeNull();
  });
});
