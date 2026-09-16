/**
 * The view tabs: built-in layouts, saved views, creating one, and the
 * Save / Reset pair when a tab no longer matches the screen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ViewTabs, type ViewTabsProps } from '@/components/tasks/ViewTabs';
import type { ApiSavedView } from '@/lib/api';
import type { FieldDef } from '@/types/fields';

const stage: FieldDef = {
  id: 'stage', name: 'Stage', kind: 'select',
  options: [{ id: 'idea', label: 'Idea', color: 'sage' }],
  fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};

const view = (over: Partial<ApiSavedView> = {}): ApiSavedView => ({
  id: 'v1', name: 'Stages', layout: 'board', scopeListId: null,
  filters: { search: '', status: '', quadrant: '', due: '', dueAfter: '', dueBefore: '', sortBy: 'order', sortDir: 'asc', fields: {}, groupBy: 'stage' },
  showDone: false, display: { hidden: [], order: [], widths: {} },
  viewOrder: 0, createdAt: 1, updatedAt: 1, ...over,
});

function setup(over: Partial<ViewTabsProps> = {}) {
  const props: ViewTabsProps = {
    layout: 'table',
    views: [view(), view({ id: 'v2', name: 'Other list', layout: 'table', scopeListId: 'other' })],
    appliedViewId: null,
    dirty: false,
    listId: 'list-1',
    listName: 'Work Focus',
    online: true,
    groupFields: [stage],
    onSelectLayout: vi.fn(),
    onApplyView: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(true),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onSaveChanges: vi.fn(),
    onResetChanges: vi.fn(),
    onManageFields: vi.fn(),
    ...over,
  };
  render(<ViewTabs {...props} />);
  return props;
}

describe('ViewTabs', () => {
  it('shows the built-in tabs and the saved views that open in this list', () => {
    setup();
    expect(screen.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Board' })).toBeInTheDocument();
    // The calendar is its own view in the rail now, across tasks and databases.
    expect(screen.queryByRole('tab', { name: 'Calendar' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stages' })).toBeInTheDocument();
    // Scoped to another list.
    expect(screen.queryByRole('tab', { name: 'Other list' })).not.toBeInTheDocument();
  });

  it('switches layout and opens a saved view', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(props.onSelectLayout).toHaveBeenCalledWith('board');
    fireEvent.click(screen.getByRole('tab', { name: 'Stages' }));
    expect(props.onApplyView).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }));
  });

  it('marks the open view as a tab, not a layout', () => {
    setup({ appliedViewId: 'v1', layout: 'board' });
    expect(screen.getByRole('tab', { name: 'Stages' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'false');
  });

  it('offers Save and Reset only when the screen no longer matches the open view', () => {
    const props = setup({ appliedViewId: 'v1', dirty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onSaveChanges).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(props.onResetChanges).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }));
  });

  it('hides Save and Reset while the view matches', () => {
    setup({ appliedViewId: 'v1', dirty: false });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('creates a board view with a name and a field', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New view' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'By stage' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create view' }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith({
      name: 'By stage', layout: 'board', groupBy: 'stage', scopeToList: true,
    }));
  });

  it('will not create a board when there is no field to make columns from', async () => {
    const props = setup({ groupFields: [] });
    fireEvent.click(screen.getByRole('button', { name: 'New view' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'By stage' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
    expect(screen.getByRole('button', { name: 'Create view' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create a field first' }));
    expect(props.onManageFields).toHaveBeenCalled();
  });

  // The tab menu is a Radix dropdown: it opens on pointer events, which
  // fireEvent.click does not send, so these use userEvent.
  it('renames, duplicates and deletes from the tab menu', async () => {
    const props = setup();
    const openMenu = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Options for Stages' }));
    };

    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Duplicate/ }));
    expect(props.onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }));

    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete view/ }));
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }));

    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }));
    const input = await screen.findByLabelText('Rename Stages');
    fireEvent.change(input, { target: { value: 'Pipeline' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }), 'Pipeline');
  });

  it('cannot create a view while the server is unreachable', () => {
    setup({ online: false });
    expect(screen.getByRole('button', { name: 'New view' })).toBeDisabled();
  });
});
