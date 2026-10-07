import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NeedsFirstDialog } from '@/components/tasks/NeedsFirstDialog';
import type { Todo } from '@/types/todo';

const t = (id: string, text: string, extra: Partial<Todo> = {}): Todo => ({ id, text, status: 'todo', createdAt: 0, listId: 'l1', order: 0, quadrant: 'do', ...extra });
const listName = (id: string) => (id === 'l1' ? 'Work' : undefined);

describe('NeedsFirstDialog', () => {
  it('names the task and what it still needs, in plain words', () => {
    render(<NeedsFirstDialog total={1} listName={listName} onDecide={vi.fn()}
      groups={[{ task: t('a', 'Ship release'), open: [t('b', 'Write notes', { dueDate: '2030-01-02' }), t('c', 'Run tests')] }]} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Ship release still needs 2 tasks first')).toBeInTheDocument();
    expect(screen.getByText('These are not done yet:')).toBeInTheDocument();
    expect(screen.getByText('Write notes')).toBeInTheDocument();
    expect(screen.getByText('Work · due Jan 2')).toBeInTheDocument();
    expect(screen.getByText('Run tests')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete anyway' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish them too' })).toBeInTheDocument();
  });

  it('says "1 task" and "Finish it too" for a single prerequisite', () => {
    render(<NeedsFirstDialog total={1} listName={listName} onDecide={vi.fn()} groups={[{ task: t('a', 'Ship release'), open: [t('b', 'Write notes')] }]} />);
    expect(screen.getByText('Ship release still needs 1 task first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish it too' })).toBeInTheDocument();
  });

  it('puts Cancel first, so Enter does not skip the check', () => {
    render(<NeedsFirstDialog total={1} listName={listName} onDecide={vi.fn()} groups={[{ task: t('a', 'A'), open: [t('b', 'B')] }]} />);
    const buttons = screen.getAllByRole('button').filter((b) => ['Cancel', 'Complete anyway', 'Finish it too'].includes(b.textContent ?? ''));
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Complete anyway', 'Finish it too']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('reports each choice, and Escape counts as Cancel', () => {
    const onDecide = vi.fn();
    render(<NeedsFirstDialog total={1} listName={listName} onDecide={onDecide} groups={[{ task: t('a', 'A'), open: [t('b', 'B')] }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish it too' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDecide.mock.calls.map((c) => c[0])).toEqual(['anyway', 'finish', 'cancel', 'cancel']);
  });

  it('groups a bulk completion by task', () => {
    render(<NeedsFirstDialog total={5} listName={listName} onDecide={vi.fn()} groups={[
      { task: t('a', 'Alpha'), open: [t('x', 'Shared step')] },
      { task: t('b', 'Beta'), open: [t('x', 'Shared step'), t('y', 'Other step')] },
      { task: t('c', 'Gamma'), open: [t('z', 'Third step')] },
    ]} />);
    expect(screen.getByText('3 of the 5 selected tasks still need other tasks first')).toBeInTheDocument();
    expect(screen.getByText('Alpha needs first:')).toBeInTheDocument();
    expect(screen.getByText('Beta needs first:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete them anyway' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish them too' })).toBeInTheDocument();
  });

  it('renders nothing while there is nothing to ask', () => {
    render(<NeedsFirstDialog total={1} listName={listName} onDecide={vi.fn()} groups={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
