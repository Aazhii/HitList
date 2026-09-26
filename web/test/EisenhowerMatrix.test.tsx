/**
 * EisenhowerMatrix tests
 * Covers: quadrant rendering, task display, status change, add button, empty state
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EisenhowerMatrix } from '@/components/EisenhowerMatrix';
import type { Todo } from '@/types/todo';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    text: 'Test task',
    note: '',
    status: 'todo',
    quadrant: 'do',
    order: 0,
    createdAt: Date.now(),
    listId: 'list-1',
    reminderEnabled: false,
    ...overrides,
  };
}

const defaultProps = {
  onStatusChange: vi.fn(),
  onDelete: vi.fn(),
  onOpen: vi.fn(),
  onAddToQuadrant: vi.fn(),
  nextId: null,
  showDone: true,
  onToggleReminder: vi.fn(),
  notificationPermission: 'default' as NotificationPermission,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EisenhowerMatrix', () => {
  it('renders all four quadrant labels', () => {
    render(<EisenhowerMatrix {...defaultProps} todos={[]} />);
    expect(screen.getByText(/do first/i)).toBeInTheDocument();
    expect(screen.getByText(/schedule/i)).toBeInTheDocument();
    expect(screen.getByText(/delegate/i)).toBeInTheDocument();
    expect(screen.getByText(/eliminate/i)).toBeInTheDocument();
  });

  it('renders a task in the correct quadrant', () => {
    const todo = makeTodo({ id: 'todo-1', text: 'Urgent task', quadrant: 'do' });
    render(<EisenhowerMatrix {...defaultProps} todos={[todo]} />);
    expect(screen.getByText('Urgent task')).toBeInTheDocument();
  });

  it('renders tasks in multiple quadrants', () => {
    const todos = [
      makeTodo({ id: '1', text: 'Do task', quadrant: 'do' }),
      makeTodo({ id: '2', text: 'Schedule task', quadrant: 'schedule' }),
      makeTodo({ id: '3', text: 'Delegate task', quadrant: 'delegate' }),
      makeTodo({ id: '4', text: 'Eliminate task', quadrant: 'eliminate' }),
    ];
    render(<EisenhowerMatrix {...defaultProps} todos={todos} />);
    expect(screen.getByText('Do task')).toBeInTheDocument();
    expect(screen.getByText('Schedule task')).toBeInTheDocument();
    expect(screen.getByText('Delegate task')).toBeInTheDocument();
    expect(screen.getByText('Eliminate task')).toBeInTheDocument();
  });

  it('hides done tasks when showDone is false', () => {
    const todos = [
      makeTodo({ id: '1', text: 'Active task', quadrant: 'do', status: 'todo' }),
      makeTodo({ id: '2', text: 'Done task', quadrant: 'do', status: 'done' }),
    ];
    render(<EisenhowerMatrix {...defaultProps} todos={todos} showDone={false} />);
    expect(screen.getByText('Active task')).toBeInTheDocument();
    expect(screen.queryByText('Done task')).not.toBeInTheDocument();
  });

  it('shows done tasks when showDone is true', () => {
    const todos = [
      makeTodo({ id: '1', text: 'Done task', quadrant: 'do', status: 'done' }),
    ];
    render(<EisenhowerMatrix {...defaultProps} todos={todos} showDone={true} />);
    expect(screen.getByText('Done task')).toBeInTheDocument();
  });

  it('calls onOpen when a task card is clicked', () => {
    const onOpen = vi.fn();
    const todo = makeTodo({ id: 'todo-1', text: 'Clickable task', quadrant: 'do' });
    render(<EisenhowerMatrix {...defaultProps} todos={[todo]} onOpen={onOpen} />);

    const card = screen.getByRole('button', { name: /open task: clickable task/i });
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(todo);
  });

  it('calls onAddToQuadrant with correct quadrant when add button is clicked', () => {
    const onAddToQuadrant = vi.fn();
    render(<EisenhowerMatrix {...defaultProps} todos={[]} onAddToQuadrant={onAddToQuadrant} />);

    // Each quadrant has an "Add task" button
    const addButtons = screen.getAllByRole('button', { name: /add task/i });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(addButtons[0]);
    expect(onAddToQuadrant).toHaveBeenCalled();
  });

  it('calls onStatusChange when status toggle is clicked', () => {
    const onStatusChange = vi.fn();
    const todo = makeTodo({ id: 'todo-1', text: 'Status task', quadrant: 'do', status: 'todo' });
    render(<EisenhowerMatrix {...defaultProps} todos={[todo]} onStatusChange={onStatusChange} />);

    // The status control is the shared StatusBox: a real checkbox, named for the
    // task it belongs to, with its state in aria-checked.
    const statusBtn = screen.getByRole('checkbox', { name: 'Status task' });
    fireEvent.click(statusBtn);
    expect(onStatusChange).toHaveBeenCalledWith('todo-1', 'in-progress');
  });

  it('marks the next task with a "Next" label', () => {
    const todo = makeTodo({ id: 'todo-1', text: 'Next task', quadrant: 'do', status: 'todo' });
    render(<EisenhowerMatrix {...defaultProps} todos={[todo]} nextId="todo-1" />);
    expect(screen.getByText('Next')).toBeInTheDocument();
  });
});
