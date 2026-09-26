/**
 * The Columns menu: showing, hiding and reordering a table's columns.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColumnsMenu, type ColumnsMenuProps } from '@/components/tasks/ColumnsMenu';

function setup(over: Partial<ColumnsMenuProps> = {}) {
  const props: ColumnsMenuProps = {
    columns: [
      { id: 'title', label: 'Title', fixed: true },
      { id: 'status', label: 'Status' },
      { id: 'due', label: 'Due' },
      { id: 'effort', label: 'Effort' },
    ],
    hidden: ['due'],
    onToggle: vi.fn(),
    onMove: vi.fn(),
    onReset: vi.fn(),
    ...over,
  };
  render(<ColumnsMenu {...props} />);
  return props;
}

describe('ColumnsMenu', () => {
  it('counts the hidden columns on the button', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Columns (1 hidden)' })).toBeInTheDocument();
  });

  it('says nothing about hidden columns when they are all shown', () => {
    setup({ hidden: [] });
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument();
  });

  it('hides a shown column and shows a hidden one', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hide Status' }));
    expect(props.onToggle).toHaveBeenCalledWith('status');
    fireEvent.click(screen.getByRole('button', { name: 'Show Due' }));
    expect(props.onToggle).toHaveBeenCalledWith('due');
  });

  it('never offers to hide Title', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    expect(await screen.findByText('Title')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide Title' })).not.toBeInTheDocument();
  });

  it('moves a column, and cannot move past either end', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move Status right' }));
    expect(props.onMove).toHaveBeenCalledWith('status', 1);
    expect(screen.getByRole('button', { name: 'Move Title left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Effort right' })).toBeDisabled();
  });

  it('puts everything back', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Show all, in field order/ }));
    expect(props.onReset).toHaveBeenCalled();
  });
});
