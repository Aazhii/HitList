/**
 * A database's records on a board: columns from one of its fields, the setup
 * screen before one is chosen, and adding a record straight into a column.
 *
 * The drop rules themselves are the task board's (boardDrop), covered in
 * TaskBoardView.test.tsx — what matters here is that records reach them.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecordBoard, type RecordBoardProps } from '@/components/databases/RecordBoard';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef, TaskFieldValues } from '@/types/fields';

const stage: FieldDef = {
  id: 'stage', name: 'Stage', kind: 'select',
  options: [{ id: 'idea', label: 'Idea', color: 'sage' }, { id: 'doing', label: 'Doing', color: 'accent' }],
  fieldOrder: 0, showOnCard: true, createdAt: 1, updatedAt: 1,
};
const tags: FieldDef = {
  id: 'tags', name: 'Tags', kind: 'multi',
  options: [{ id: 'home', label: 'Home', color: 'sage' }],
  fieldOrder: 1, showOnCard: true, createdAt: 1, updatedAt: 1,
};
const notes: FieldDef = { id: 'memo', name: 'Memo', kind: 'text', options: [], fieldOrder: 2, showOnCard: false, createdAt: 1, updatedAt: 1 };

const record = (over: Partial<ApiDatabaseRow> = {}): ApiDatabaseRow => ({
  id: 'r1', databaseId: 'db1', title: 'Dune', rowOrder: 0, createdAt: 1, updatedAt: 1, ...over,
});

const values: TaskFieldValues = { r1: { stage: 'idea' }, r2: {} };

function setup(over: Partial<RecordBoardProps> = {}) {
  const props: RecordBoardProps = {
    rows: [record(), record({ id: 'r2', title: 'Ubik', rowOrder: 1 })],
    fields: [stage, tags, notes],
    values,
    groupField: stage,
    onGroupFieldChange: vi.fn(),
    onManageFields: vi.fn(),
    onSetValue: vi.fn(),
    onAdd: vi.fn(),
    ...over,
  };
  render(<RecordBoard {...props} />);
  return props;
}

describe('RecordBoard', () => {
  it('puts each record in its column, and keeps one for no value', () => {
    setup();
    expect(within(screen.getByRole('region', { name: /Idea/ })).getByText('Dune')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Doing/ })).toHaveTextContent('Drop a record here');
    expect(within(screen.getByRole('region', { name: /No Stage/ })).getByText('Ubik')).toBeInTheDocument();
  });

  it('says which field the columns come from, and switches to another', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Columns from Stage' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Tags/ }));
    expect(props.onGroupFieldChange).toHaveBeenCalledWith('tags');
  });

  it('goes back to choosing, and offers to create a column', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Columns from Stage' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Choose later' }));
    expect(props.onGroupFieldChange).toHaveBeenCalledWith('');

    await userEvent.click(screen.getByRole('button', { name: 'Columns from Stage' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Create a column/ }));
    expect(props.onManageFields).toHaveBeenCalled();
  });

  it('adds a record straight into a column', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Doing' }));
    const input = screen.getByRole('textbox', { name: 'New record in Doing' });
    fireEvent.change(input, { target: { value: 'Neuromancer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onAdd).toHaveBeenCalledWith('Neuromancer', 'doing');
  });

  it('adds nothing for an empty title', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add record to Doing' }));
    const input = screen.getByRole('textbox', { name: 'New record in Doing' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it('asks for a field when none is chosen, offering only the groupable ones', () => {
    const props = setup({ groupField: null });
    expect(screen.getByRole('button', { name: /Stage/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tags/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Memo/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Stage/ }));
    expect(props.onGroupFieldChange).toHaveBeenCalledWith('stage');
  });

  it('explains which columns cannot make board columns, and offers to create one', () => {
    const props = setup({ groupField: null, fields: [notes] });
    expect(screen.getByText(/Memo \(Text\) can't make columns/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create a column/ }));
    expect(props.onManageFields).toHaveBeenCalled();
  });

  it('shows a record with no card fields as just its title', () => {
    setup({ fields: [notes], groupField: stage, values: { r1: { memo: 'hidden' } } });
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
  });
});
