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
    expect(screen.getByRole('button', { name: 'Add note emoji' })).toBeInTheDocument();
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

  it('lets the user add an emoji again after keyboard removal', async () => {
    const onEmoji = vi.fn();
    render(<Header onEmoji={onEmoji} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Change note emoji' }), { key: 'Delete' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add note emoji' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: NOTE_EMOJIS[0] }));
    expect(onEmoji).toHaveBeenLastCalledWith(NOTE_EMOJIS[0]);
    expect(screen.getByRole('button', { name: 'Change note emoji' })).toHaveTextContent(NOTE_EMOJIS[0]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});