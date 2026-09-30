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
    onRenameField: vi.fn(),
    onChangeFieldOptions: vi.fn(),
    onFilterField: vi.fn(),
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
    onOpenRecord: vi.fn(),
    showPageIcon: true,
    onTogglePageIcon: vi.fn(),
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

  it('opens the column menu from the header and renames from its first row', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Status column options' }));
    const name = await screen.findByLabelText('Property name');
    fireEvent.change(name, { target: { value: 'Stage' } });
    fireEvent.blur(name);
    expect(props.onRenameField).toHaveBeenCalledWith('status', 'Stage');
  });

  it('offers Filter, which opens the filter on that column', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Status column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Filter/ }));
    expect(props.onFilterField).toHaveBeenCalledWith('status');
  });

  it('edits options at once, and asks before removing one a record uses', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Status column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Edit options/ }));
    const add = await screen.findByLabelText('Add an option');
    fireEvent.change(add, { target: { value: 'Paused' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(props.onChangeFieldOptions).toHaveBeenLastCalledWith('status', expect.arrayContaining([expect.objectContaining({ label: 'Paused' })]));

    // "Read" is used by Dune, so its first click only asks.
    const removes = await screen.findAllByRole('button', { name: 'Remove option' });
    vi.mocked(props.onChangeFieldOptions).mockClear();
    fireEvent.click(removes[0]);
    expect(props.onChangeFieldOptions).not.toHaveBeenCalled();
  });

  it('deletes a column only after confirming', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Status column options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete property/ }));
    expect(props.onDeleteField).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete from every record/ }));
    expect(props.onDeleteField).toHaveBeenCalledWith('status');
  });

  it('adds a column from the + header', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add a property' }));
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

  it("gives Title its own menu: page icon, no change type / hide / delete", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Title column options' }));
    expect(await screen.findByRole('menuitem', { name: /Show page icon/ })).toBeInTheDocument();
    for (const gone of [/Change type/, /Hide/, /Duplicate/, /Delete/]) {
      expect(screen.queryByRole('menuitem', { name: gone })).not.toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('menuitem', { name: /Freeze/ }));
    expect(props.onFreezeField).toHaveBeenCalledWith('title');
    await userEvent.click(screen.getByRole('menuitem', { name: /Sort descending/ }));
    expect(props.onSortField).toHaveBeenCalledWith('title', -1);
  });

  it('pins Title and every column up to the frozen one, each after the widths before it', () => {
    setup({ frozenFieldId: 'owned' });
    const left = (name: RegExp) => screen.getByRole('columnheader', { name }).style.left;
    expect(left(/Title/)).toBe('var(--tbl-inset)');
    expect(left(/Status/)).toBe('calc(var(--tbl-inset) + 260px)');
    expect(left(/Owned/)).toBe('calc(var(--tbl-inset) + 400px)');
    expect(left(/Pages/)).toBe('');
  });

  it('pins only Title when Title is what is frozen', () => {
    setup({ frozenFieldId: 'title' });
    expect(screen.getByRole('columnheader', { name: /Title/ }).style.left).toBe('var(--tbl-inset)');
    expect(screen.getByRole('columnheader', { name: /Status/ }).style.left).toBe('');
  });

  it('drops the page icon from the Title cell when it is turned off', () => {
    setup({ showPageIcon: false });
    expect(screen.queryByRole('button', { name: 'Open Dune' })).not.toBeInTheDocument();
  });

  it('opens the record peek from the page icon', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open Dune' }));
    expect(props.onOpenRecord).toHaveBeenCalledWith('r1');
  });
});
