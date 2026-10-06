/**
 * TaskDetailPanel tests
 * Covers: render, state-sync when todo changes, delete flow
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TaskDetailPanel', () => {
  it.each(['Save', 'Close', 'Escape'])('clears the due date and time through %s', (action) => {
    const onUpdate = vi.fn();
    const todo = makeTodo({ dueDate: '2030-06-15', dueTime: '12:01', reminderEnabled: true, recurrence: 'daily' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByDisplayValue('2030-06-15'), { target: { value: '' } });
    if (action === 'Escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: action === 'Close' ? /close/i : 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(todo.id, expect.objectContaining({
      dueDate: '', dueTime: '', recurrence: '', reminderEnabled: false,
    }));
  });

  it('clears the time without clearing the date', () => {
    const onUpdate = vi.fn();
    const todo = makeTodo({ dueDate: '2030-06-15', dueTime: '12:01' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByDisplayValue('12:01'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(todo.id, expect.objectContaining({ dueDate: '2030-06-15', dueTime: '' }));
  });

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

  it('offers a reminder for a task with a due date, and no escalation', () => {
    const todo = makeTodo({ dueDate: '2026-09-30', dueTime: '09:00', reminderEnabled: true, reminderMinutesBefore: 30 });
    render(<TaskDetailPanel {...defaultProps} todo={todo} />);
    expect(screen.getByRole('combobox', { name: 'Reminder' })).toHaveTextContent('30 min before');
    expect(screen.queryByText('Set up escalation')).not.toBeInTheDocument();
  });

  it('cannot set a reminder without a due date', () => {
    render(<TaskDetailPanel {...defaultProps} todo={makeTodo({ dueDate: undefined })} />);
    expect(screen.getByRole('combobox', { name: 'Reminder' })).toBeDisabled();
  });

  it('saves the reminder with the task', async () => {
    const onUpdate = vi.fn();
    const todo = makeTodo({ dueDate: '2026-09-30', dueTime: '09:00' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Reminder' }));
    await userEvent.click(await screen.findByRole('option', { name: '1 hour before' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(todo.id, expect.objectContaining({ reminderEnabled: true, reminderMinutesBefore: 60 }));
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

    // Delete opens a confirmation dialog (showcase 962–964), it does not delete by itself.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete this task?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));

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

  it('keeps the task when the confirmation is dismissed', async () => {
    const onDelete = vi.fn();
    render(<TaskDetailPanel {...defaultProps} todo={makeTodo()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep task' }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('is a peek panel: no scrim, and it names the list in the delete confirmation', async () => {
    render(<TaskDetailPanel {...defaultProps} todo={makeTodo({ text: 'Ship it' })} listName="Work" />);
    // Non-modal: the page behind stays interactive, so there is no dialog overlay.
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/“Ship it” will be removed from Work\./)).toBeInTheDocument();
  });

  it('calls onUpdate with changed text when Save is clicked, and closes', async () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const todo = makeTodo({ id: 'todo-1', text: 'Original text' });
    render(<TaskDetailPanel {...defaultProps} todo={todo} onUpdate={onUpdate} onClose={onClose} />);

    const input = screen.getByDisplayValue('Original text');
    fireEvent.change(input, { target: { value: 'Updated text' } });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({ text: 'Updated text' })
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
