/**
 * The record peek: title, one editable row per property, close and delete.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecordPeek } from '@/components/databases/RecordPeek';
import type { FieldDef } from '@/types/fields';

const status: FieldDef = {
  id: 'status', name: 'Status', kind: 'select',
  options: [{ id: 'read', label: 'Read', color: 'sage' }],
  fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};
const pages: FieldDef = { id: 'pages', name: 'Pages', kind: 'number', options: [], fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1 };

function setup() {
  const props = {
    record: { id: 'r1', databaseId: 'db1', title: 'Dune', rowOrder: 0, createdAt: 1, updatedAt: 1 },
    databaseName: 'Reading list',
    fields: [status, pages],
    values: { status: 'read', pages: 412 },
    onClose: vi.fn(), onRename: vi.fn(), onSetValue: vi.fn(), onDelete: vi.fn(),
  };
  render(<RecordPeek {...props} />);
  return props;
}

describe('RecordPeek', () => {
  it('shows the database, the title and a row per property', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Record' });
    expect(dialog).toHaveTextContent('Reading list');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Dune');
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Pages of Dune')).toHaveValue(412);
  });

  it('renames on Enter, and keeps the old title for an empty one', () => {
    const props = setup();
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Dune Messiah' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.blur(title);
    expect(props.onRename).toHaveBeenCalledWith('Dune Messiah');

    fireEvent.change(title, { target: { value: '  ' } });
    fireEvent.blur(title);
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(title).toHaveValue('Dune');
  });

  it('edits a property in place', () => {
    const props = setup();
    const cell = screen.getByLabelText('Pages of Dune');
    fireEvent.change(cell, { target: { value: '500' } });
    fireEvent.blur(cell);
    expect(props.onSetValue).toHaveBeenCalledWith('pages', 500);
  });

  it('closes from the button and on Escape', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('deletes only after a second click', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete for good' }));
    expect(props.onDelete).toHaveBeenCalled();
  });
});
