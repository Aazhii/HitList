/**
 * TaskDetailPanel tests
 * Covers: render, state-sync when todo changes, delete flow
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import type { Todo } from '@/types/todo';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    text: 'Write unit tests',
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
  open: true,
  onClose: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onStatusChange: vi.fn(),
  notificationPermission: 'default' as NotificationPermission,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TaskDetailPanel', () => {
  it('renders the task text in the title input', () => {
    const todo = makeTodo({ text: 'Write unit tests' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} />);
    const input = screen.getByDisplayValue('Write unit tests');
    expect(input).toBeInTheDocument();
  });

  it('renders the task note when provided', () => {
    const todo = makeTodo({ note: 'Some important note' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} />);
    expect(screen.getByDisplayValue('Some important note')).toBeInTheDocument();
  });

  it('syncs state when a different todo is passed (state-sync regression)', async () => {
    const todo1 = makeTodo({ id: 'todo-1', text: 'First task' });
    const todo2 = makeTodo({ id: 'todo-2', text: 'Second task' });

    const { rerender } = render(<TaskDetailPanel {...defaultProps} todo={todo1} />);
    expect(screen.getByDisplayValue('First task')).toBeInTheDocument();

    rerender(<TaskDetailPanel {...defaultProps} todo={todo2} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Second task')).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('First task')).not.toBeInTheDocument();
  });

  it('syncs note when switching tasks', async () => {
    const todo1 = makeTodo({ id: 'todo-1', text: 'Task A', note: 'Note A' });
    const todo2 = makeTodo({ id: 'todo-2', text: 'Task B', note: 'Note B' });

    const { rerender } = render(<TaskDetailPanel {...defaultProps} todo={todo1} />);
    expect(screen.getByDisplayValue('Note A')).toBeInTheDocument();

    rerender(<TaskDetailPanel {...defaultProps} todo={todo2} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Note B')).toBeInTheDocument();
    });
  });

  it('calls onDelete with the correct task id when delete is confirmed', async () => {
    const onDelete = vi.fn();
    const todo = makeTodo({ id: 'todo-abc', text: 'Delete me' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} onDelete={onDelete} />);

    // Click the delete button to show confirm state
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);

    // Confirm delete
    const confirmBtn = await screen.findByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('todo-abc');
    });
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    const todo = makeTodo();
    render(<TaskDetailPanel {...defaultProps} todo={todo} onClose={onClose} />);

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders null-safe when todo is null', () => {
    const { container } = render(<TaskDetailPanel {...defaultProps} todo={null} open={false} />);
    // Panel is closed — nothing meaningful should be visible
    expect(container).toBeTruthy();
  });

  it('calls onUpdate with changed text when Save is clicked', async () => {
    const onUpdate = vi.fn();
    const todo = makeTodo({ id: 'todo-1', text: 'Original text' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} onUpdate={onUpdate} />);

    const input = screen.getByDisplayValue('Original text');
    fireEvent.change(input, { target: { value: 'Updated text' } });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({ text: 'Updated text' })
      );
    });
  });
});
