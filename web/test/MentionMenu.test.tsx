import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MentionMenu, type MentionMenuHandle } from '@/components/notes/MentionMenu';
import type { KaizenList } from '@/types/todo';

const lists: KaizenList[] = [
  { id: 'growth', name: 'Daily Growth', color: 'emerald', createdAt: 1 },
  { id: 'work', name: 'Work Focus', color: 'blue', createdAt: 2 },
  { id: 'side', name: 'Side project', color: 'rose', createdAt: 3 },
];

function setup(props: Partial<React.ComponentProps<typeof MentionMenu>> = {}) {
  const ref = createRef<MentionMenuHandle>();
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <MentionMenu
      ref={ref}
      position={{ top: 10, left: 10 }}
      lists={lists}
      query=""
      pending={false}
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />,
  );
  const key = (k: string) => {
    let used = false;
    act(() => { used = ref.current!.handleKey(k); });
    return used;
  };
  return { ...utils, ref, onSelect, onClose, key };
}

describe('MentionMenu', () => {
  it('walks Add to quadrant → workspace → quadrant by keyboard', () => {
    const { key, onSelect } = setup({ preferredListId: 'work' });

    expect(screen.queryByRole('listbox', { name: 'Workspace' })).toBeNull();
    expect(key('Enter')).toBe(true);                       // open workspaces
    expect(screen.getByRole('listbox', { name: 'Workspace' })).toBeTruthy();

    // The preferred list comes first; move to the second (Daily Growth).
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('Work Focus');
    key('ArrowDown');
    key('ArrowRight');                                     // open quadrants for Daily Growth
    expect(screen.getByRole('listbox', { name: 'Quadrant in Daily Growth' })).toBeTruthy();

    key('ArrowDown');                                      // Schedule
    key('Enter');
    expect(onSelect).toHaveBeenCalledWith('growth', 'schedule');
  });

  it('opens the next column on hover and selects on click', () => {
    const { onSelect } = setup();
    fireEvent.mouseEnter(screen.getByRole('button', { name: /add to quadrant/i }));
    fireEvent.mouseEnter(screen.getByRole('option', { name: /work focus/i }));
    fireEvent.click(screen.getByRole('option', { name: /do first/i }));
    expect(onSelect).toHaveBeenCalledWith('work', 'do');
  });

  it('filters the focused column by the typed query', () => {
    const { key, rerender, ref, onSelect, onClose } = setup();
    key('Enter');
    rerender(
      <MentionMenu ref={ref} position={{ top: 10, left: 10 }} lists={lists} query="side"
        pending={false} onSelect={onSelect} onClose={onClose} />,
    );
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Side project');
  });

  it('closes on Escape and lets ← through at the first column', () => {
    const { key, onClose } = setup();
    expect(key('ArrowLeft')).toBe(false);
    key('Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a message instead of rows when there is nothing to add', () => {
    setup({ message: 'Write the task in this block first, then type @' });
    expect(screen.getByText(/write the task in this block first/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add to quadrant/i })).toBeNull();
  });
});
