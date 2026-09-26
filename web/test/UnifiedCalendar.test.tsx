/**
 * The one calendar: tasks and database records on the same month grid.
 *
 * The grid arithmetic is covered in calendar.test.ts. What matters here is that
 * two kinds of thing live together — placed, filtered, dragged and opened the
 * same way — since that is the whole point of merging the two calendars.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  UnifiedCalendar, type CalendarItem, type CalendarSource, type UnifiedCalendarProps,
} from '@/components/calendar/UnifiedCalendar';

const TODAY = new Date(2026, 8, 16, 12, 0, 0);

const task = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  kind: 'task', id: 't1', title: 'Ship the table', date: '2026-09-18', time: '14:30',
  sourceId: 'work', sourceName: 'Work Focus', ...over,
});
const record = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  kind: 'record', id: 'r1', title: 'Dune', date: '2026-09-18',
  sourceId: 'books', sourceName: 'Reading list', ...over,
});
const zohoEvent = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  kind: 'zoho', id: 'z1', title: 'Team planning', date: '2026-09-18', time: '09:00',
  sourceId: 'zoho:primary', sourceName: 'Zoho Personal', ...over,
});

const sources: CalendarSource[] = [
  { kind: 'task', id: 'work', name: 'Work Focus', dotClass: 'bg-blue-500' },
  { kind: 'record', id: 'books', name: 'Reading list', dotClass: 'bg-a-sage' },
  { kind: 'zoho', id: 'zoho:primary', name: 'Zoho Personal', dotClass: 'bg-sky-500' },
];

function setup(over: Partial<UnifiedCalendarProps> = {}) {
  const props: UnifiedCalendarProps = {
    items: [task(), record(), task({ id: 't2', title: 'No date yet', date: '', time: undefined })],
    sources,
    hiddenSources: [],
    onToggleSource: vi.fn(),
    onMove: vi.fn(),
    onOpen: vi.fn(),
    onAddOnDate: vi.fn(),
    today: TODAY,
    ...over,
  };
  render(<UnifiedCalendar {...props} />);
  return props;
}

describe('UnifiedCalendar', () => {
  it('puts a task and a record on the same day', () => {
    setup();
    const friday = screen.getByRole('group', { name: 'Friday, September 18, 2026' });
    expect(within(friday).getByText('Ship the table')).toBeInTheDocument();
    expect(within(friday).getByText('Dune')).toBeInTheDocument();
  });

  it('shows a task\'s time, and names where each thing came from', () => {
    setup();
    expect(screen.getByRole('button', { name: /Ship the table, 14:30 — Work Focus/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dune — Reading list/ })).toBeInTheDocument();
  });

  it('puts anything without a date in the tray', () => {
    setup();
    const tray = screen.getByRole('complementary', { name: 'Without a date' });
    expect(within(tray).getByText('No date yet')).toBeInTheDocument();
  });

  it('hides a whole source when its chip is switched off', () => {
    const props = setup({ hiddenSources: ['books'] });
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
    expect(screen.getByText('Ship the table')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reading list' }));
    expect(props.onToggleSource).toHaveBeenCalledWith('books');
  });

  it('marks today, and moves between months', () => {
    setup();
    const today = screen.getByRole('group', { name: 'Wednesday, September 16, 2026' });
    expect(within(today).getByText('16')).toHaveAttribute('aria-current', 'date');

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
  });

  it('opens whichever kind was clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /Dune — Reading list/ }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'record', id: 'r1' }));

    fireEvent.click(screen.getByRole('button', { name: /Ship the table/ }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'task', id: 't1' }));
  });

  it('renders Zoho events as read-only and filters their calendar', () => {
    const props = setup({ items: [task(), zohoEvent()] });
    expect(screen.getByRole('button', { name: /Team planning, 09:00 — Zoho Personal/ })).toHaveAttribute(
      'aria-roledescription', 'Read-only Zoho Calendar event',
    );
    fireEvent.click(screen.getByRole('button', { name: /Team planning/ }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'zoho' }));
    expect(props.onMove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Zoho Personal' }));
    expect(props.onToggleSource).toHaveBeenCalledWith('zoho:primary');
  });

  it('asks the caller to add on a day', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add on Monday, September 21, 2026' }));
    expect(props.onAddOnDate).toHaveBeenCalledWith('2026-09-21', expect.anything());
  });

  it('shows a done task struck through', () => {
    setup({ items: [task({ done: true })] });
    expect(screen.getByRole('button', { name: /, done — Work Focus/ })).toBeInTheDocument();
  });

  it('collapses a busy day behind "+N more", listing the whole day', async () => {
    const many = Array.from({ length: 5 }, (_, i) => record({ id: `m${i}`, title: `Record ${i + 1}` }));
    setup({ items: many });

    const friday = screen.getByRole('group', { name: 'Friday, September 18, 2026' });
    expect(within(friday).getByText('Record 1')).toBeInTheDocument();
    expect(within(friday).queryByText('Record 4')).not.toBeInTheDocument();

    await userEvent.click(within(friday).getByRole('button', { name: /Show all 5 on/ }));
    expect(await screen.findByRole('button', { name: /Record 5/ })).toBeInTheDocument();
  });
});
