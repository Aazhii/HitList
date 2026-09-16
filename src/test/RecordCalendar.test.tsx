/**
 * A database's records on a month grid: choosing the date field, records on
 * their day, the no-date tray, and adding on a day.
 *
 * The grid arithmetic itself (monthWeeks) and the placement (recordsByDay) are
 * covered in calendar.test.ts; this is the screen over them.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RecordCalendar, type RecordCalendarProps } from '@/components/databases/RecordCalendar';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef, TaskFieldValues } from '@/types/fields';

const due: FieldDef = { id: 'due', name: 'Due', kind: 'date', options: [], fieldOrder: 0, showOnCard: true, createdAt: 1, updatedAt: 1 };
const started: FieldDef = { id: 'started', name: 'Started', kind: 'date', options: [], fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1 };
const memo: FieldDef = { id: 'memo', name: 'Memo', kind: 'text', options: [], fieldOrder: 2, showOnCard: false, createdAt: 1, updatedAt: 1 };

const record = (over: Partial<ApiDatabaseRow> = {}): ApiDatabaseRow => ({
  id: 'r1', databaseId: 'db1', title: 'Dune', rowOrder: 0, createdAt: 1, updatedAt: 1, ...over,
});

const values: TaskFieldValues = { r1: { due: '2026-09-18' } };
const TODAY = new Date(2026, 8, 16, 12, 0, 0);

function setup(over: Partial<RecordCalendarProps> = {}) {
  const props: RecordCalendarProps = {
    rows: [record(), record({ id: 'r2', title: 'Ubik', rowOrder: 1 })],
    fields: [due, started, memo],
    values,
    dateField: due,
    onDateFieldChange: vi.fn(),
    onManageFields: vi.fn(),
    onSetDate: vi.fn(),
    onAdd: vi.fn(),
    today: TODAY,
    ...over,
  };
  render(<RecordCalendar {...props} />);
  return props;
}

describe('RecordCalendar', () => {
  it('shows the month, and puts a record on the day its date field holds', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    const friday = screen.getByRole('group', { name: 'Friday, September 18, 2026' });
    expect(within(friday).getByText('Dune')).toBeInTheDocument();
  });

  it('puts records with no date in the tray, named after the field', () => {
    setup();
    const tray = screen.getByRole('complementary', { name: 'Records with no Due' });
    expect(within(tray).getByText('Ubik')).toBeInTheDocument();
  });

  it('marks today', () => {
    setup();
    const today = screen.getByRole('group', { name: 'Wednesday, September 16, 2026' });
    expect(within(today).getByText('16')).toHaveAttribute('aria-current', 'date');
  });

  it('says which field the dates come from, and switches to another', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Dates from Due' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Started/ }));
    expect(props.onDateFieldChange).toHaveBeenCalledWith('started');
  });

  it('goes back to choosing, and offers to create a date column', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Dates from Due' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Choose later' }));
    expect(props.onDateFieldChange).toHaveBeenCalledWith('');

    await userEvent.click(screen.getByRole('button', { name: 'Dates from Due' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Create a date column/ }));
    expect(props.onManageFields).toHaveBeenCalled();
  });

  it('moves between months and back to today', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
  });

  it('adds a record on a day', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add record on Monday, September 21, 2026' }));
    const input = screen.getByRole('textbox', { name: 'New record on Monday, September 21, 2026' });
    fireEvent.change(input, { target: { value: 'Neuromancer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onAdd).toHaveBeenCalledWith('Neuromancer', '2026-09-21');
  });

  it('asks for a date column when the database has none chosen', () => {
    const props = setup({ dateField: null });
    expect(screen.getByText('Choose the dates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Due' }));
    expect(props.onDateFieldChange).toHaveBeenCalledWith('due');
  });

  it('offers to create one when the database has no date column at all', () => {
    const props = setup({ dateField: null, fields: [memo] });
    expect(screen.getByText(/There isn't one yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create a date column/ }));
    expect(props.onManageFields).toHaveBeenCalled();
  });
});
