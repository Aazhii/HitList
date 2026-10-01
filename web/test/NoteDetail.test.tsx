import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteDetail } from '@/components/NotesWorkspace';
import { createNewNote, NOTE_EMOJIS } from '@/types/notes';

vi.mock('@/components/NoteEditor', () => ({ NoteEditor: () => null }));

function Header({ onEmoji }: { onEmoji: (emoji: string) => void }) {
  const [note, setNote] = useState(() => ({ ...createNewNote('Meeting notes'), emoji: NOTE_EMOJIS[7] }));
  return <NoteDetail
    note={note}
    onUpdateTitle={(_id, title) => setNote((current) => ({ ...current, title }))}
    onUpdateEmoji={(_id, emoji) => {
      onEmoji(emoji);
      setNote((current) => ({ ...current, emoji }));
    }}
    onUpdateBlock={vi.fn()}
    onAddBlock={() => 'new-block'}
    onDeleteBlock={vi.fn()}
    onChangeBlockType={vi.fn()}
    onMoveBlock={vi.fn()}
  />;
}

describe('note emoji keyboard deletion', () => {
  it('places the emoji beside the editable title and allows long titles to wrap', () => {
    render(<Header onEmoji={vi.fn()} />);
    const title = screen.getByRole('textbox', { name: 'Note title' });
    const emoji = screen.getByRole('button', { name: 'Change note emoji' });
    expect(title.parentElement).toBe(emoji.parentElement);
    expect(title.parentElement).toHaveClass('flex', 'items-start', 'min-w-0');
    expect(emoji).toHaveClass('size-10', 'shrink-0');
    expect(emoji).not.toHaveClass('mb-4');
    expect(title).toHaveClass('min-w-0', 'flex-1', '[overflow-wrap:anywhere]');
    fireEvent.change(title, { target: { value: 'A longer title that remains editable' } });
    expect(title).toHaveValue('A longer title that remains editable');
  });

  it('removes the emoji with Backspace at the start without changing the title or focus', () => {
    const onEmoji = vi.fn();
    render(<Header onEmoji={onEmoji} />);
    const title = screen.getByRole('textbox', { name: 'Note title' }) as HTMLTextAreaElement;
    title.focus();
    title.setSelectionRange(0, 0);
    expect(fireEvent.keyDown(title, { key: 'Backspace' })).toBe(false);
    expect(onEmoji).toHaveBeenCalledExactlyOnceWith('');
    expect(title).toHaveValue('Meeting notes');
    expect(title).toHaveFocus();
    expect(screen.queryByRole('button', { name: /note emoji/ })).not.toBeInTheDocument();
    expect(title.parentElement?.children).toHaveLength(1);
    expect(fireEvent.keyDown(title, { key: 'Backspace' })).toBe(true);
    expect(onEmoji).toHaveBeenCalledTimes(1);
  });

  it.each(['Backspace', 'Delete'])('removes the focused emoji with %s', (key) => {
    const onEmoji = vi.fn();
    render(<Header onEmoji={onEmoji} />);
    const emoji = screen.getByRole('button', { name: 'Change note emoji' });
    emoji.focus();
    expect(fireEvent.keyDown(emoji, { key })).toBe(false);
    expect(onEmoji).toHaveBeenCalledExactlyOnceWith('');
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Meeting notes');
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /note emoji/ })).not.toBeInTheDocument();
  });

  it('preserves ordinary text deletion, selections, shortcuts and composition', () => {
    const onEmoji = vi.fn();
    render(<Header onEmoji={onEmoji} />);
    const title = screen.getByRole('textbox', { name: 'Note title' }) as HTMLTextAreaElement;
    title.setSelectionRange(3, 3);
    expect(fireEvent.keyDown(title, { key: 'Backspace' })).toBe(true);
    title.setSelectionRange(0, 3);
    expect(fireEvent.keyDown(title, { key: 'Backspace' })).toBe(true);
    title.setSelectionRange(0, 0);
    expect(fireEvent.keyDown(title, { key: 'Delete' })).toBe(true);
    expect(fireEvent.keyDown(title, { key: 'Backspace', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(title, { key: 'Backspace', isComposing: true })).toBe(true);
    expect(onEmoji).not.toHaveBeenCalled();
  });

  it('still lets the user change an existing emoji', async () => {
    const onEmoji = vi.fn();
    render(<Header onEmoji={onEmoji} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Change note emoji' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: NOTE_EMOJIS[0] }));
    expect(onEmoji).toHaveBeenLastCalledWith(NOTE_EMOJIS[0]);
    expect(screen.getByRole('button', { name: 'Change note emoji' })).toHaveTextContent(NOTE_EMOJIS[0]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});