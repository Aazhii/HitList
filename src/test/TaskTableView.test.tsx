/**
 * The table layout: rows and columns, sorting from the headers, and editing in place.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskTableView, type TaskTableViewProps } from '@/components/tasks/TaskTableView';
import { DEFAULT_FILTERS, compareAcrossQuadrants } from '@/lib/taskFilters';
import type { FieldDef, TaskFieldValues } from '@/types/fields';
import type { Todo } from '@/types/todo';

const effort: FieldDef = {
  id: 'effort', name: 'Effort', kind: 'select',
  options: [{ id: 'lo', label: 'Low', color: 'sage' }, { id: 'hi', label: 'High', color: 'do' }],
  fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};
const points: FieldDef = { id: 'pts', name: 'Points', kind: 'number', options: [], fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1 };

const task = (over: Partial<Todo>): Todo => ({
  id: 'x', text: 'Task', status: 'todo', createdAt: 1, listId: 'l', order: 0, quadrant: 'do', ...over,
});
const alpha = task({ id: 'a', text: 'Alpha', order: 1 });
const beta = task({ id: 'b', text: 'Beta', order: 2, quadrant: 'schedule' });
const finished = task({ id: 'd', text: 'Finished', status: 'done' });
const values: TaskFieldValues = { a: { effort: 'hi', pts: 3 }, b: { effort: 'lo' } };

function setup(over: Partial<TaskTableViewProps> = {}) {
  const props: TaskTableViewProps = {
    todos: [alpha, beta, finished],
    showDone: false,
    compare: compareAcrossQuadrants(DEFAULT_FILTERS),
    sortBy: 'order',
    sortDir: 'asc',
    onSortChange: vi.fn(),
    groupField: null,
    fieldDefs: [effort, points],
    fieldValues: values,
    onStatusChange: vi.fn(),
    onUpdate: vi.fn(),
    onSetFieldValue: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  const utils = render(<TaskTableView {...props} />);
  return { props, ...utils };
}

describe('TaskTableView', () => {
  it('shows a row per open task and a column per field', () => {
    setup();
    expect(screen.getByRole('columnheader', { name: 'Effort' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Points' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alpha')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Finished')).not.toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByLabelText('Points of Alpha')).toHaveValue(3);
  });

  it('shows done tasks when asked', () => {
    setup({ showDone: true });
    expect(screen.getByDisplayValue('Finished')).toBeInTheDocument();
  });

  it('sorts from a header: ascending, then descending, then back to manual order', () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    expect(props.onSortChange).toHaveBeenLastCalledWith('title', 'asc');

    rerender(<TaskTableView {...props} sortBy="title" sortDir="asc" />);
    expect(screen.getByRole('columnheader', { name: 'Title' })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    expect(props.onSortChange).toHaveBeenLastCalledWith('title', 'desc');

    rerender(<TaskTableView {...props} sortBy="title" sortDir="desc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    expect(props.onSortChange).toHaveBeenLastCalledWith('order', 'asc');

    fireEvent.click(screen.getByRole('button', { name: 'Effort' }));
    expect(props.onSortChange).toHaveBeenLastCalledWith('field:effort', 'asc');
  });

  it('saves a title edit on Enter, and nothing when it did not change', () => {
    const { props } = setup();
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onUpdate).toHaveBeenCalledWith('a', { text: 'Alpha 2' });

    const other = screen.getByDisplayValue('Beta');
    fireEvent.blur(other);
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty title and puts the old one back', () => {
    const { props } = setup();
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(input).toHaveValue('Alpha');
  });

  it('clears a number when emptied, and sets it as a number', () => {
    const { props } = setup();
    const cell = screen.getByLabelText('Points of Alpha');
    fireEvent.change(cell, { target: { value: '' } });
    fireEvent.blur(cell);
    expect(props.onSetFieldValue).toHaveBeenLastCalledWith('a', 'pts', null);

    const empty = screen.getByLabelText('Points of Beta');
    fireEvent.change(empty, { target: { value: '8' } });
    fireEvent.blur(empty);
    expect(props.onSetFieldValue).toHaveBeenLastCalledWith('b', 'pts', 8);
  });

  it('clears a due date by sending an empty date', () => {
    const { props } = setup({ todos: [task({ id: 'a', text: 'Alpha', dueDate: '2030-06-15' })] });
    const cell = screen.getByLabelText('Due date of Alpha');
    fireEvent.change(cell, { target: { value: '' } });
    fireEvent.blur(cell);
    expect(props.onUpdate).toHaveBeenCalledWith('a', { dueDate: '' });
  });

  it('groups rows under each option of the group-by field', () => {
    setup({ groupField: effort });
    expect(screen.getByRole('rowheader', { name: /Low/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /High/ })).toBeInTheDocument();
  });
});
