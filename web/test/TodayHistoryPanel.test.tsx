import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TodayHistoryPanel } from '@/components/TodayHistoryPanel';
import type { Todo } from '@/types/todo';

const doneToday: Todo = {
  id: 't1',
  text: 'Ship the report',
  status: 'done',
  createdAt: Date.now() - 60_000,
  completedAt: Date.now(),
  listId: 'l1',
  order: 0,
  quadrant: 'do',
};

describe('TodayHistoryPanel undo', () => {
  it('calls onUndo with the task id and disables the button while pending', async () => {
    let resolve!: () => void;
    const onUndo = vi.fn(() => new Promise<void>((r) => { resolve = r; }));

    render(<TodayHistoryPanel open todos={[doneToday]} onClose={() => {}} onUndo={onUndo} />);

    const button = screen.getByRole('button', { name: /undo completing ship the report/i });
    fireEvent.click(button);

    expect(onUndo).toHaveBeenCalledWith('t1');
    await waitFor(() => expect(button).toBeDisabled());

    resolve();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('shows no undo button when no handler is given', () => {
    render(<TodayHistoryPanel open todos={[doneToday]} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /undo completing/i })).toBeNull();
  });
});
