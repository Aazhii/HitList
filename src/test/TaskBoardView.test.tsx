/**
 * The board: what a drop changes for each kind of field, the columns, and
 * choosing a field.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_COLUMN_PREFIX, TaskBoardView, boardCardId, boardDrop, parseBoardCardId, type TaskBoardViewProps,
} from '@/components/tasks/TaskBoardView';
import { DEFAULT_FILTERS, FIELD_EMPTY, FIELD_SET, compareAcrossQuadrants } from '@/lib/taskFilters';
import type { FieldDef, TaskFieldValues } from '@/types/fields';
import type { Todo } from '@/types/todo';

const stage: FieldDef = {
  id: 'stage', name: 'Stage', kind: 'select',
  options: [{ id: 'idea', label: 'Idea', color: 'sage' }, { id: 'doing', label: 'Doing', color: 'accent' }],
  fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};
const tags: FieldDef = {
  id: 'tags', name: 'Tags', kind: 'multi',
  options: [{ id: 'home', label: 'Home', color: 'sage' }, { id: 'work', label: 'Work', color: 'do' }, { id: 'urgent', label: 'Urgent', color: 'accent' }],
  fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1,
};
const blocked: FieldDef = { id: 'blocked', name: 'Blocked', kind: 'checkbox', options: [], fieldOrder: 2, showOnCard: false, createdAt: 1, updatedAt: 1 };
const memo: FieldDef = { id: 'memo', name: 'Memo', kind: 'text', options: [], fieldOrder: 3, showOnCard: false, createdAt: 1, updatedAt: 1 };

const task = (over: Partial<Todo>): Todo => ({
  id: 'x', text: 'Task', status: 'todo', createdAt: 1, listId: 'l', order: 0, quadrant: 'do', ...over,
});
const values: TaskFieldValues = {
  a: { stage: 'idea', tags: ['home', 'work'], blocked: true },
  b: { stage: 'removed-option' },
};
const column = (key: string) => `${BOARD_COLUMN_PREFIX}${key}`;

describe('board card ids', () => {
  it('round-trips the column and the task', () => {
    expect(parseBoardCardId(boardCardId(FIELD_EMPTY, 'task-1'))).toEqual({ columnKey: FIELD_EMPTY, taskId: 'task-1' });
    expect(parseBoardCardId('no-separator')).toBeNull();
  });
});

describe('boardDrop — select', () => {
  it('sets the option of the column a card is dropped on, or clears it', () => {
    expect(boardDrop(boardCardId('idea', 'a'), column('doing'), stage, values)).toEqual({ taskId: 'a', value: 'doing' });
    expect(boardDrop(boardCardId('idea', 'a'), column(FIELD_EMPTY), stage, values)).toEqual({ taskId: 'a', value: null });
  });

  it('changes nothing for its own column, nowhere, or a column that is not an option', () => {
    expect(boardDrop(boardCardId('idea', 'a'), column('idea'), stage, values)).toBeNull();
    expect(boardDrop(boardCardId('idea', 'a'), null, stage, values)).toBeNull();
    expect(boardDrop(boardCardId('idea', 'a'), 'some-other-droppable', stage, values)).toBeNull();
    expect(boardDrop(boardCardId('idea', 'a'), column('not-an-option'), stage, values)).toBeNull();
  });

  it('treats a deleted option as no value', () => {
    expect(boardDrop(boardCardId(FIELD_EMPTY, 'b'), column('idea'), stage, values)).toEqual({ taskId: 'b', value: 'idea' });
  });
});

describe('boardDrop — multi-select', () => {
  it('swaps only the option of the column the card came from', () => {
    expect(boardDrop(boardCardId('home', 'a'), column('urgent'), tags, values)).toEqual({ taskId: 'a', value: ['work', 'urgent'] });
  });

  it('just removes the old option when the task already has the new one', () => {
    expect(boardDrop(boardCardId('home', 'a'), column('work'), tags, values)).toEqual({ taskId: 'a', value: ['work'] });
  });

  it('removes that option when dropped on no value, and adds one to a task with none', () => {
    expect(boardDrop(boardCardId('work', 'a'), column(FIELD_EMPTY), tags, values)).toEqual({ taskId: 'a', value: ['home'] });
    expect(boardDrop(boardCardId(FIELD_EMPTY, 'b'), column('home'), tags, values)).toEqual({ taskId: 'b', value: ['home'] });
  });

  it('clears the field when the last option is moved to no value', () => {
    const one: TaskFieldValues = { c: { tags: ['work'] } };
    expect(boardDrop(boardCardId('work', 'c'), column(FIELD_EMPTY), tags, one)).toEqual({ taskId: 'c', value: null });
  });
});

describe('boardDrop — checkbox', () => {
  it('ticks and unticks, and ignores a drop that changes nothing', () => {
    expect(boardDrop(boardCardId(FIELD_SET, 'a'), column(FIELD_EMPTY), blocked, values)).toEqual({ taskId: 'a', value: null });
    expect(boardDrop(boardCardId(FIELD_EMPTY, 'b'), column(FIELD_SET), blocked, values)).toEqual({ taskId: 'b', value: true });
    expect(boardDrop(boardCardId(FIELD_EMPTY, 'b'), column('other'), blocked, values)).toBeNull();
  });
});

function setup(over: Partial<TaskBoardViewProps> = {}) {
  const props: TaskBoardViewProps = {
    todos: [task({ id: 'a', text: 'Write the brief' }), task({ id: 'b', text: 'Book the room' })],
    showDone: false,
    compare: compareAcrossQuadrants(DEFAULT_FILTERS),
    groupField: stage,
    fieldDefs: [stage, tags, blocked, memo],
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
    expect(screen.getByRole('region', { name: /Idea/ })).toHaveTextContent('Write the brief');
    expect(screen.getByRole('region', { name: /Doing/ })).toHaveTextContent('Drop a task here');
    expect(screen.getByRole('region', { name: /No Stage/ })).toHaveTextContent('Book the room');
  });

  it('puts a multi-select task in the column of each of its options', () => {
    setup({ groupField: tags });
    expect(screen.getByRole('region', { name: /Home/ })).toHaveTextContent('Write the brief');
    expect(screen.getByRole('region', { name: /Work/ })).toHaveTextContent('Write the brief');
    expect(screen.getByRole('region', { name: /No Tags/ })).toHaveTextContent('Book the room');
  });

  it('makes Checked and Not checked columns for a checkbox', () => {
    setup({ groupField: blocked });
    expect(screen.getByRole('region', { name: /^Checked/ })).toHaveTextContent('Write the brief');
    expect(screen.getByRole('region', { name: /Not checked/ })).toHaveTextContent('Book the room');
  });

  it('offers select, multi-select and checkbox fields when none is chosen, and uses the one picked', () => {
    const props = setup({ groupField: null });
    expect(screen.queryByRole('button', { name: /Memo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tags/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Blocked/ }));
    expect(props.onGroupFieldChange).toHaveBeenCalledWith('blocked');
  });

  it('explains which fields cannot make columns, and offers to create one', () => {
    const props = setup({ groupField: null, fieldDefs: [memo] });
    const setupText = screen.getByText(/Columns come from/);
    expect(within(setupText).getByText(/Memo \(Text\) can't make columns/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create a field/ }));
    expect(props.onManageFields).toHaveBeenCalled();
  });

  it('says fields are unavailable when the server cannot be reached', () => {
    setup({ groupField: null, fieldDefs: [], fieldsOnline: false });
    expect(screen.getByText(/unreachable right now/)).toBeInTheDocument();
  });
});
