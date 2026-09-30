/**
 * The filter popover's contents: the selects that edit the filter state, Clear all,
 * Show completed / Clear done, and Save as a view.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterPanel } from '@/components/tasks/FilterPanel';
import { DEFAULT_FILTERS } from '@/lib/taskFilters';
import type { FieldDef } from '@/types/fields';

const stage: FieldDef = {
  id: 'stage', name: 'Stage', kind: 'select',
  options: [{ id: 'idea', label: 'Idea', color: 'sage' }],
  fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};

function setup(over: Partial<React.ComponentProps<typeof FilterPanel>> = {}) {
  const props: React.ComponentProps<typeof FilterPanel> = {
    filters: DEFAULT_FILTERS, onChange: vi.fn(), fieldDefs: [stage], layout: 'table',
    showDone: false, onShowDoneChange: vi.fn(), doneCount: 2, onClearDone: vi.fn(),
    listName: 'Work', onSaveView: vi.fn().mockResolvedValue(true), ...over,
  };
  render(<FilterPanel {...props} />);
  return props;
}

describe('FilterPanel', () => {
  it('shows the six design selects plus one per custom field', () => {
    setup();
    for (const name of ['Status', 'Quadrant', 'Category', 'Due', 'Sort by', 'Group by', 'Stage']) {
      expect(screen.getByRole('combobox', { name })).toBeInTheDocument();
    }
  });

  it('leaves out Group by in the matrix, where grouping by a field does not apply', () => {
    setup({ layout: 'matrix' });
    expect(screen.queryByRole('combobox', { name: 'Group by' })).not.toBeInTheDocument();
  });

  it('sets the category filter from its select', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('combobox', { name: 'Category' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Health' }));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ category: 'health' }));
  });

  it('counts only the filters that hide tasks, and clears them all', () => {
    const props = setup({ filters: { ...DEFAULT_FILTERS, status: 'IN_PROGRESS', category: 'health', sortBy: 'title' } });
    expect(screen.getByText('2 active')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(props.onChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });

  it('offers Clear done with the count', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear done (2)' }));
    expect(props.onClearDone).toHaveBeenCalled();
  });

  it('saves a view scoped to the list by default, and unscoped when unticked', async () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText('View name'), { target: { value: ' Health this week ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() => expect(props.onSaveView).toHaveBeenCalledWith('Health this week', true));

    fireEvent.click(screen.getByLabelText('Only show in Work'));
    fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Everywhere' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() => expect(props.onSaveView).toHaveBeenLastCalledWith('Everywhere', false));
  });

  it('does not save a view without a name', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(props.onSaveView).not.toHaveBeenCalled();
  });
});
