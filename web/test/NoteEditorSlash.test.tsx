import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteEditor } from '@/components/NoteEditor';
import type { NoteBlock } from '@/types/notes';

function Editor() {
  const [blocks, setBlocks] = useState<NoteBlock[]>([{ id: 'block', type: 'paragraph', content: '' }]);
  return <NoteEditor
    blocks={blocks}
    onUpdateBlock={(id, changes) => setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...changes } : block))}
    onAddBlock={() => 'new-block'}
    onDeleteBlock={vi.fn()}
    onChangeBlockType={(id, type) => setBlocks((current) => current.map((block) => block.id === id ? { ...block, type } : block))}
    onMoveBlock={vi.fn()}
  />;
}

describe('notes slash search', () => {
  it('filters as the user types and restores options when the query is removed', () => {
    render(<Editor />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/' } });
    expect(screen.getByRole('option', { name: /Plain paragraph/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '/d' } });
    fireEvent.change(input, { target: { value: '/database' } });
    expect(screen.getByRole('option', { name: /Create database/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Plain paragraph/ })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '/' } });
    expect(screen.getByRole('option', { name: /Plain paragraph/ })).toBeInTheDocument();
  });

  it('selects the filtered command with Enter', () => {
    render(<Editor />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/' } });
    fireEvent.change(input, { target: { value: '/h2' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('listbox', { name: 'Block types' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Heading 2')).toHaveValue('');
  });
});