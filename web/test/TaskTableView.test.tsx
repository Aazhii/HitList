/**
 * The table layout: rows and columns, sorting from the headers, and editing in place.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    onDelete: vi.fn(),
    onAddTask: vi.fn(),
    onEditField: vi.fn(),
    onDeleteField: vi.fn(),
    onCreateField: vi.fn(),
    onHideColumn: vi.fn(),
    ...over,
  };
  const utils = render(<TaskTableView {...props} />);
  return { props, ...utils };
}

describe('TaskTableView', () => {
  it('shows a row per open task and a column per field', () => {
    setup();
    expect(screen.getByRole('columnheader', { name: /Effort/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Points/ })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.queryByText('Finished')).not.toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByLabelText('Points of Alpha')).toHaveValue(3);
  });

  it('shows done tasks when asked', () => {
    setup({ showDone: true });
    expect(screen.getByText('Finished')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit title of Alpha' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onUpdate).toHaveBeenCalledWith('a', { text: 'Alpha 2' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit title of Beta' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Title' }));
    expect(props.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty title and puts the old one back', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title of Alpha' }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
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

  it('shows the due date in words and clears it from the popover', async () => {
    const { props } = setup({ todos: [task({ id: 'a', text: 'Alpha', dueDate: '2030-06-15' })] });
    const cell = screen.getByRole('button', { name: 'Due date of Alpha' });
    expect(cell).toHaveTextContent('Jun 15');
    await userEvent.click(cell);
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(props.onUpdate).toHaveBeenCalledWith('a', { dueDate: '' });
  });

  it('groups rows under each option of the group-by field', () => {
    setup({ groupField: effort });
    expect(screen.getByRole('rowheader', { name: /Low/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /High/ })).toBeInTheDocument();
  });
});

describe('TaskTableView — rows, columns and fields', () => {
  it('adds a task from the last row, carrying the group it was added in', () => {
    const { props } = setup({ groupField: effort });
    fireEvent.change(screen.getByRole('textbox', { name: 'New task in High' }), { target: { value: 'Write it up' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New task in High' }), { key: 'Enter' });
    expect(props.onAddTask).toHaveBeenCalledWith('Write it up', 'hi');
  });

  it('adds nothing for an empty title', () => {
    const { props } = setup();
    const input = screen.getByRole('textbox', { name: 'New task in this list' });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onAddTask).not.toHaveBeenCalled();
  });

  // Radix menus open on pointer events, so these use userEvent.
  it('deletes a row only after confirming', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Options for Alpha' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete task/ }));
    expect(props.onDelete).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete for good/ }));
    expect(props.onDelete).toHaveBeenCalledWith('a');
  });

  it('opens a row from its menu', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Options for Alpha' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('edits and hides a field from its column menu, and deletes it only after confirming', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Effort column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit field/ }));
    expect(props.onEditField).toHaveBeenCalledWith('effort');

    await userEvent.click(screen.getByRole('button', { name: 'Effort column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Hide column/ }));
    expect(props.onHideColumn).toHaveBeenCalledWith('effort');

    await userEvent.click(screen.getByRole('button', { name: 'Effort column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete field/ }));
    expect(props.onDeleteField).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete from every task/ }));
    expect(props.onDeleteField).toHaveBeenCalledWith('effort');
  });

  it('leaves hidden columns out, and never hides Title', () => {
    setup({ hiddenColumns: ['quadrant', 'effort', 'title'] });
    expect(screen.queryByRole('columnheader', { name: /Quadrant/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Effort/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Title/ })).toBeInTheDocument();
  });

  it('adds a field from the + header', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add a field' }));
    expect(props.onCreateField).toHaveBeenCalled();
  });

  it('ticks a checkbox field without the native box', () => {
    const flag: FieldDef = { id: 'flag', name: 'Flag', kind: 'checkbox', options: [], fieldOrder: 2, showOnCard: false, createdAt: 1, updatedAt: 1 };
    const { props } = setup({ fieldDefs: [flag], fieldValues: {} });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Flag of Alpha' }));
    expect(props.onSetFieldValue).toHaveBeenCalledWith('a', 'flag', true);
  });
});
