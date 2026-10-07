import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatrixTaskCard } from '@/components/MatrixTaskCard';
import { WaitingBadge, WaitingCountsContext } from '@/components/tasks/WaitingBadge';
import type { Todo } from '@/types/todo';

describe('WaitingBadge', () => {
  it('says how many tasks this one is waiting on, and nothing when it is not', () => {
    const { rerender } = render(<WaitingCountsContext.Provider value={new Map([['a', 2]])}><WaitingBadge taskId="a" /></WaitingCountsContext.Provider>);
    expect(screen.getByText('Waiting on 2')).toHaveAttribute('title', 'Needs 2 tasks done first');
    rerender(<WaitingCountsContext.Provider value={new Map([['a', 1]])}><WaitingBadge taskId="a" /></WaitingCountsContext.Provider>);
    expect(screen.getByText('Waiting on 1')).toHaveAttribute('title', 'Needs 1 task done first');
    rerender(<WaitingCountsContext.Provider value={new Map()}><WaitingBadge taskId="a" /></WaitingCountsContext.Provider>);
    expect(screen.queryByText(/Waiting on/)).toBeNull();
  });

  it('shows on a task card that waits, and not on one that is done', () => {
    const todo = (status: Todo['status']): Todo => ({ id: 'a', text: 'Ship release', status, createdAt: 0, listId: 'l', order: 0, quadrant: 'do' });
    const counts = new Map([['a', 2]]);
    const props = { onStatusChange: () => {}, onDelete: () => {}, onOpen: () => {} } as unknown as Omit<React.ComponentProps<typeof MatrixTaskCard>, 'todo'>;
    const { rerender } = render(<WaitingCountsContext.Provider value={counts}><MatrixTaskCard {...props} todo={todo('todo')} /></WaitingCountsContext.Provider>);
    expect(screen.getByText('Waiting on 2')).toBeInTheDocument();
    rerender(<WaitingCountsContext.Provider value={counts}><MatrixTaskCard {...props} todo={todo('done')} /></WaitingCountsContext.Provider>);
    expect(screen.queryByText(/Waiting on/)).toBeNull();
  });
});
