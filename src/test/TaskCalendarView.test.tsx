/**
 * The calendar layout: tasks on their days, the no-date tray, month navigation,
 * opening a task and adding one on a day.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskCalendarView, type TaskCalendarViewProps } from '@/components/tasks/TaskCalendarView';
import { compareTasks } from '@/lib/quadrantBuckets';
import type { Todo } from '@/types/todo';

const task = (over: Partial<Todo>): Todo => ({
  id: 'x', text: 'Task', status: 'todo', createdAt: 1, listId: 'l', order: 0, quadrant: 'do', ...over,
});

const TODAY = new Date(2026, 8, 16, 12, 0, 0);

function setup(over: Partial<TaskCalendarViewProps> = {}) {
  const props: TaskCalendarViewProps = {
    todos: [
      task({ id: 'a', text: 'Ship the table', dueDate: '2026-09-18', dueTime: '14:30' }),
      task({ id: 'b', text: 'Plan the calendar' }),
      task({ id: 'c', text: 'Finished thing', dueDate: '2026-09-18', status: 'done' }),
    ],
    showDone: false,
    compare: compareTasks,
    onMove: vi.fn(),
    onOpen: vi.fn(),
    onAddOnDate: vi.fn(),
    today: TODAY,
    ...over,
  };
  render(<TaskCalendarView {...props} />);
  return props;
}

describe('TaskCalendarView', () => {
  it('shows the month, puts a task on its day with its time, and marks today', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    const friday = screen.getByRole('group', { name: 'Friday, September 18, 2026' });
    expect(within(friday).getByRole('button', { name: 'Ship the table, 14:30' })).toBeInTheDocument();
    expect(within(friday).queryByText('Finished thing')).not.toBeInTheDocument();
    const today = screen.getByRole('group', { name: 'Wednesday, September 16, 2026' });
    expect(within(today).getByText('16')).toHaveAttribute('aria-current', 'date');
  });

  it('lists tasks with no due date in the tray', () => {
    setup();
    const tray = screen.getByRole('complementary', { name: 'Tasks without a due date' });
    expect(within(tray).getByText('Plan the calendar')).toBeInTheDocument();
  });

  it('shows done tasks when asked', () => {
    setup({ showDone: true });
    expect(screen.getByRole('button', { name: 'Finished thing, done' })).toBeInTheDocument();
  });

  it('opens a task when it is clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Ship the table, 14:30' }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('adds a task on a day', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add task on Monday, September 21, 2026' }));
    expect(props.onAddOnDate).toHaveBeenCalledWith('2026-09-21');
  });

  it('moves between months and back to today', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
  });
});

describe('TaskCalendarView — a busy day', () => {
  const many = Array.from({ length: 5 }, (_, i) => task({
    id: `m${i}`, text: `Task ${i + 1}`, dueDate: '2026-09-18',
  }));

  it('shows the first few, then "+N more"', () => {
    setup({ todos: many });
    const friday = screen.getByRole('group', { name: 'Friday, September 18, 2026' });
    expect(within(friday).getByText('Task 1')).toBeInTheDocument();
    expect(within(friday).getByText('Task 3')).toBeInTheDocument();
    expect(within(friday).queryByText('Task 4')).not.toBeInTheDocument();
    expect(within(friday).getByRole('button', { name: /Show all 5 tasks/ })).toHaveTextContent('+2 more');
  });

  it('lists the whole day behind it, and opens a task from there', async () => {
    const props = setup({ todos: many });
    await userEvent.click(screen.getByRole('button', { name: /Show all 5 tasks/ }));
    // Task 5 is only in the popover, never on the grid.
    await userEvent.click(await screen.findByRole('button', { name: 'Task 5' }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'm4' }));
  });

  it('leaves a quiet day alone', () => {
    setup();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});
