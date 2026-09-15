/**
 * The board layout: what a drop changes, the columns, and choosing a field.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_COLUMN_PREFIX, TaskBoardView, boardDrop, type TaskBoardViewProps } from '@/components/tasks/TaskBoardView';
import { DEFAULT_FILTERS, FIELD_EMPTY, compareAcrossQuadrants } from '@/lib/taskFilters';
import type { FieldDef, TaskFieldValues } from '@/types/fields';
import type { Todo } from '@/types/todo';

const stage: FieldDef = {
  id: 'stage', name: 'Stage', kind: 'select',
  options: [{ id: 'idea', label: 'Idea', color: 'sage' }, { id: 'doing', label: 'Doing', color: 'accent' }],
  fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};
const notes: FieldDef = { id: 'memo', name: 'Memo', kind: 'text', options: [], fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1 };

const task = (over: Partial<Todo>): Todo => ({
  id: 'x', text: 'Task', status: 'todo', createdAt: 1, listId: 'l', order: 0, quadrant: 'do', ...over,
});
const values: TaskFieldValues = { a: { stage: 'idea' }, b: { stage: 'removed-option' } };
const column = (key: string) => `${BOARD_COLUMN_PREFIX}${key}`;

describe('boardDrop', () => {
  it('sets the option of the column a task is dropped on', () => {
    expect(boardDrop('a', column('doing'), stage, values)).toEqual({ taskId: 'a', value: 'doing' });
  });

  it('clears the value when dropped on the no-value column', () => {
    expect(boardDrop('a', column(FIELD_EMPTY), stage, values)).toEqual({ taskId: 'a', value: null });
  });

  it('changes nothing when dropped back on its own column, or nowhere', () => {
    expect(boardDrop('a', column('idea'), stage, values)).toBeNull();
    expect(boardDrop('a', null, stage, values)).toBeNull();
    expect(boardDrop('a', 'some-other-droppable', stage, values)).toBeNull();
  });

  it('treats a deleted option as no value, and refuses a column that is not an option', () => {
    expect(boardDrop('b', column(FIELD_EMPTY), stage, values)).toBeNull();
    expect(boardDrop('b', column('idea'), stage, values)).toEqual({ taskId: 'b', value: 'idea' });
    expect(boardDrop('a', column('not-an-option'), stage, values)).toBeNull();
  });
});

function setup(over: Partial<TaskBoardViewProps> = {}) {
  const props: TaskBoardViewProps = {
    todos: [task({ id: 'a', text: 'Write the brief' }), task({ id: 'b', text: 'Book the room' })],
    showDone: false,
    compare: compareAcrossQuadrants(DEFAULT_FILTERS),
    groupField: stage,
    fieldDefs: [stage, notes],
    fieldValues: values,
    fieldsOnline: true,
    fieldsLoading: false,
    nextId: null,
    onGroupFieldChange: vi.fn(),
    onManageFields: vi.fn(),
    onSetFieldValue: vi.fn(),
    onStatusChange: vi.fn(),
    onDelete: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  render(<TaskBoardView {...props} />);
  return props;
}

describe('TaskBoardView', () => {
  it('shows a column per option and one for no value, with each task in its column', () => {
    setup();
    const idea = screen.getByRole('region', { name: /Idea/ });
    expect(idea).toHaveTextContent('Write the brief');
    expect(screen.getByRole('region', { name: /Doing/ })).toHaveTextContent('Drop a task here');
    expect(screen.getByRole('region', { name: /No Stage/ })).toHaveTextContent('Book the room');
  });

  it('asks for a select field when none is chosen, and uses the one picked', () => {
    const props = setup({ groupField: null });
    expect(screen.queryByRole('button', { name: 'Memo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    expect(props.onGroupFieldChange).toHaveBeenCalledWith('stage');
  });

  it('offers to create a select field when there is none', () => {
    const props = setup({ groupField: null, fieldDefs: [notes] });
    fireEvent.click(screen.getByRole('button', { name: /Create a select field/ }));
    expect(props.onManageFields).toHaveBeenCalled();
  });

  it('says fields are unavailable when the server cannot be reached', () => {
    setup({ groupField: null, fieldDefs: [], fieldsOnline: false });
    expect(screen.getByText(/unreachable right now/)).toBeInTheDocument();
  });
});
