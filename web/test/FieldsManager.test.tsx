/**
 * The fields manager: one panel with the list, the selected field's editor, usage counts,
 * Done, and the delete warning.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldsManagerDialog } from '@/components/fields/FieldsManager';
import type { FieldDef } from '@/types/fields';

const stage: FieldDef = {
  id: 'stage', name: 'Stage', kind: 'select',
  options: [{ id: 'backlog', label: 'Backlog', color: 'gray' }, { id: 'blocked', label: 'Blocked', color: 'red' }],
  fieldOrder: 0, showOnCard: true, createdAt: 1, updatedAt: 1,
};
const estimate: FieldDef = { id: 'est', name: 'Estimate', kind: 'number', options: [], fieldOrder: 1, showOnCard: false, createdAt: 1, updatedAt: 1 };

function setup(over: Partial<React.ComponentProps<typeof FieldsManagerDialog>> = {}) {
  const props: React.ComponentProps<typeof FieldsManagerDialog> = {
    open: true, onOpenChange: vi.fn(), fields: [stage, estimate],
    onCreate: vi.fn().mockResolvedValue(stage), onUpdate: vi.fn().mockResolvedValue(stage), onDelete: vi.fn().mockResolvedValue(true),
    optionUsage: (_f, o) => (o === 'backlog' ? 5 : 0),
    fieldUsage: () => ({ valueCount: 12, viewNames: ['Board · By stage', 'Default table'] }),
    ...over,
  };
  render(<FieldsManagerDialog {...props} />);
  return props;
}

describe('FieldsManagerDialog', () => {
  it('lists every field with its type and edits the first one', () => {
    setup();
    const panel = screen.getByRole('dialog', { name: 'Fields' });
    expect(within(panel).getByRole('button', { name: /Stage\s*Select/ })).toHaveAttribute('aria-current', 'true');
    expect(within(panel).getByRole('button', { name: /Estimate\s*Number/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Option 1')).toHaveValue('Backlog');
  });

  it('shows how many tasks use each option', () => {
    setup();
    expect(screen.getByText('5 tasks')).toBeInTheDocument();
    expect(screen.getByText('unused')).toBeInTheDocument();
  });

  it('saves edits when Done is pressed, and leaves an untouched field alone', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(props.onUpdate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Phase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith('stage', expect.objectContaining({ name: 'Phase' })));
  });

  it('warns before Done removes an option', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Blocked' }));
    expect(screen.getByText(/Saving removes “Blocked” from every task that uses it/)).toBeInTheDocument();
  });

  it('asks before deleting a field, saying what goes with it', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(await screen.findByText('Delete the “Stage” field?')).toBeInTheDocument();
    expect(screen.getByText(/It has a value on 12 tasks and is used by 2 saved views: Board · By stage and Default table\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete field and 12 values' }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('stage'));
  });

  it('opens straight into a new field, whose type can be chosen', () => {
    setup({ startNew: true });
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Type' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete field' })).not.toBeInTheDocument();
  });

  it('cannot change the type of an existing field', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeDisabled();
  });
});
