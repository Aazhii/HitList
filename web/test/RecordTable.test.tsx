/**
 * A database's records as a table: rows and columns, editing in place, and the
 * column menu that changes the field from where it is used.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecordTable, type RecordTableProps } from '@/components/databases/RecordTable';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef } from '@/types/fields';

const status: FieldDef = {
  id: 'status', name: 'Status', kind: 'select',
  options: [{ id: 'read', label: 'Read', color: 'sage' }, { id: 'next', label: 'Next', color: 'accent' }],
  fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};
const owned: FieldDef = { id: 'owned', name: 'Owned', kind: 'checkbox', options: [], fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1 };
const pages: FieldDef = { id: 'pages', name: 'Pages', kind: 'number', options: [], fieldOrder: 2, showOnCard: false, createdAt: 1, updatedAt: 1 };
const review: FieldDef = { id: 'review', name: 'Review', kind: 'longtext', options: [], fieldOrder: 3, showOnCard: false, createdAt: 1, updatedAt: 1 };

const record = (over: Partial<ApiDatabaseRow> = {}): ApiDatabaseRow => ({
  id: 'r1', databaseId: 'db1', title: 'Dune', rowOrder: 0, createdAt: 1, updatedAt: 1, ...over,
});

function setup(over: Partial<RecordTableProps> = {}) {
  const props: RecordTableProps = {
    rows: [record(), record({ id: 'r2', title: 'Ubik', rowOrder: 1 })],
    fields: [status, owned, pages],
    titleLabel: 'Title',
    onRenameTitleLabel: vi.fn(),
    values: { r1: { status: 'read', owned: true, pages: 412 } },
    loading: false,
    onAdd: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onSetValue: vi.fn(),
    onEditField: vi.fn(),
    onDeleteField: vi.fn(),
    onCreateField: vi.fn(),
    onReorderFields: vi.fn(),
    sort: null,
    onSortField: vi.fn(),
    onClearSort: vi.fn(),
    groupFieldId: null,
    onGroupField: vi.fn(),
    calc: {},
    onCalcField: vi.fn(),
    frozenFieldId: null,
    onFreezeField: vi.fn(),
    wrapFieldIds: [],
    onWrapField: vi.fn(),
    colWidths: {},
    onResizeField: vi.fn(),
    onHideField: vi.fn(),
    onInsertField: vi.fn(),
    onDuplicateField: vi.fn(),
    onChangeFieldKind: vi.fn(),
    ...over,
  };
  render(<RecordTable {...props} />);
  return props;
}

describe('RecordTable', () => {
  it('shows a row per record and a column per field', () => {
    setup();
    expect(screen.getByRole('columnheader', { name: /Title/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Status/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Pages/ })).toBeInTheDocument();
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByText('Ubik')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByLabelText('Pages of Dune')).toHaveValue(412);
    expect(screen.getByRole('checkbox', { name: 'Owned of Dune' })).toHaveAttribute('aria-checked', 'true');
  });

  it('says so when a database has no records yet', () => {
    setup({ rows: [] });
    expect(screen.getByText(/No records yet/)).toBeInTheDocument();
  });

  it('adds a record, and adds nothing for an empty title', () => {
    const props = setup();
    // The last row is a ghost "New record" button (showcase 641); clicking it opens the title field.
    fireEvent.click(screen.getByRole('button', { name: 'New record' }));
    const input = screen.getByRole('textbox', { name: 'New record' });

    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onAdd).not.toHaveBeenCalled();

    // A blank submit closes the field; open it again for a real one.
    fireEvent.click(screen.getByRole('button', { name: 'New record' }));
    const again = screen.getByRole('textbox', { name: 'New record' });
    fireEvent.change(again, { target: { value: 'Neuromancer' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(props.onAdd).toHaveBeenCalledWith('Neuromancer');
  });

  it('renames a record on Enter, and keeps the old title when emptied', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title of Dune' }));
    const editor = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(editor, { target: { value: 'Dune (1965)' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith('r1', 'Dune (1965)');

    fireEvent.click(screen.getByRole('button', { name: 'Edit title of Ubik' }));
    const second = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(second, { target: { value: '   ' } });
    fireEvent.blur(second);
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ubik')).toBeInTheDocument();
  });

  it('sets and clears a field value', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Owned of Dune' }));
    expect(props.onSetValue).toHaveBeenLastCalledWith('r1', 'owned', null);

    const cell = screen.getByLabelText('Pages of Ubik');
    fireEvent.change(cell, { target: { value: '224' } });
    fireEvent.blur(cell);
    expect(props.onSetValue).toHaveBeenLastCalledWith('r2', 'pages', 224);
  });

  // Radix menus open on pointer events, so these use userEvent.
  it('deletes a record only after confirming', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Options for Dune' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete record/ }));
    expect(props.onDelete).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete for good/ }));
    expect(props.onDelete).toHaveBeenCalledWith('r1');
  });

  it('edits a column, and deletes one only after confirming', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Status column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit column/ }));
    expect(props.onEditField).toHaveBeenCalledWith('status');

    await userEvent.click(screen.getByRole('button', { name: 'Status column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete property/ }));
    expect(props.onDeleteField).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete from every record/ }));
    expect(props.onDeleteField).toHaveBeenCalledWith('status');
  });

  it('adds a column from the + header', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add a column' }));
    expect(props.onCreateField).toHaveBeenCalled();
  });

  // A `text` cell is a single-line input: a paragraph scrolls sideways and is
  // effectively unreadable. `longtext` is the same stored string in a textarea
  // that wraps and grows.
  it('edits a text-area column in a textarea, not a one-line input', () => {
    const para = 'A long review that runs past the width of its column and needs to wrap onto a second line.';
    const props = setup({ fields: [review], values: { r1: { review: para } } });

    const cell = screen.getByLabelText('Review of Dune');
    expect(cell.tagName).toBe('TEXTAREA');
    expect(cell).toHaveValue(para);

    fireEvent.change(cell, { target: { value: 'Shorter now' } });
    fireEvent.blur(cell);
    expect(props.onSetValue).toHaveBeenLastCalledWith('r1', 'review', 'Shorter now');
  });

  it('clears a text-area cell to null when emptied', () => {
    const props = setup({ fields: [review], values: { r1: { review: 'something' } } });
    const cell = screen.getByLabelText('Review of Dune');
    fireEvent.change(cell, { target: { value: '' } });
    fireEvent.blur(cell);
    expect(props.onSetValue).toHaveBeenLastCalledWith('r1', 'review', null);
  });

  it('offers Text area in the change-type submenu', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Status column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Change type/ }));
    expect(await screen.findByRole('menuitem', { name: /Text area/ })).toBeInTheDocument();
  });

  it('resizes a column by dragging its header edge', () => {
    const props = setup();
    const handle = screen.getByRole('separator', { name: 'Resize Status' });

    fireEvent.pointerDown(handle, { clientX: 200 });
    fireEvent(document, new PointerEvent('pointermove', { clientX: 260 }));
    fireEvent(document, new PointerEvent('pointerup', {}));

    // 140 (a select's showcase width) + 60 dragged
    expect(props.onResizeField).toHaveBeenLastCalledWith('status', 200);
  });

  it('shows a record with no values as empty cells', () => {
    setup({ rows: [record({ id: 'r2', title: 'Ubik' })], values: {} });
    const row = screen.getByText('Ubik').closest('tr')!;
    expect(within(row).getByRole('checkbox', { name: 'Owned of Ubik' })).toHaveAttribute('aria-checked', 'false');
    expect(within(row).getByLabelText('Pages of Ubik')).toHaveValue(null);
  });
});
