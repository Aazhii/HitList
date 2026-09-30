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
      contextLabel="Note block"
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
  it('adds with the defaults on ↵: Schedule, in the preferred list', () => {
    const { key, onSelect } = setup({ preferredListId: 'work' });
    expect(screen.getByText('Add this line to a quadrant')).toBeTruthy();
    expect(key('Enter')).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('work', 'schedule');
  });

  it('walks the quadrant grid with the arrow keys', () => {
    const { key, onSelect } = setup({ preferredListId: 'work' });
    key('ArrowLeft');                                   // Do first
    expect(screen.getByRole('radio', { name: /do first/i })).toHaveAttribute('aria-checked', 'true');
    key('ArrowDown');                                   // Delegate, below it
    expect(screen.getByRole('radio', { name: /delegate/i })).toHaveAttribute('aria-checked', 'true');
    key('ArrowRight');                                  // Eliminate
    key('Tab');
    expect(onSelect).toHaveBeenCalledWith('work', 'eliminate');
  });

  it('picks a quadrant by click, and adds from the button', () => {
    const { onSelect } = setup({ preferredListId: 'side' });
    fireEvent.click(screen.getByRole('radio', { name: /delegate/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onSelect).toHaveBeenCalledWith('side', 'delegate');
  });

  it('starts on what was typed after the @', () => {
    const { key, onSelect } = setup({ preferredListId: 'work', query: 'del' });
    key('Enter');
    expect(onSelect).toHaveBeenCalledWith('work', 'delegate');
  });

  it('closes from Cancel and on Escape', () => {
    const { key, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows a message instead of the form when there is nothing to add', () => {
    const { key, onSelect } = setup({ message: 'Write the task in this block first, then type @' });
    expect(screen.getByText(/write the task in this block first/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(key('Enter')).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
