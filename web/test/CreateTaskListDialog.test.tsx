import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { CreateTaskListDialog } from '@/components/tasks/CreateTaskListDialog';
import { ListSidebar } from '@/components/ListSidebar';

describe('create a list before adding tasks', () => {
  it('saves the chosen name and colour', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(true);
    render(<CreateTaskListDialog open onOpenChange={vi.fn()} onCreate={onCreate} />);
    expect(screen.getByRole('button', { name: 'Create list' })).toBeDisabled();
    await user.type(screen.getByLabelText('List name'), '  Work  ');
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    await user.click(screen.getByRole('button', { name: 'Create list' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Work', 'blue'));
  });

  it('keeps the popup and draft name on save failure', async () => {
    const onOpenChange = vi.fn();
    render(<CreateTaskListDialog open onOpenChange={onOpenChange} onCreate={vi.fn().mockResolvedValue(false)} />);
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Personal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByLabelText('List name')).toHaveValue('Personal');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('cancels without creating a list', () => {
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();
    render(<CreateTaskListDialog open onOpenChange={onOpenChange} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('allows confirming deletion of the last list', () => {
    const onDeleteList = vi.fn();
    render(<ListSidebar lists={[{ id: 'work', name: 'Work', color: 'blue', createdAt: 1 }]} activeListId="work" todoCounts={{}} onSelectList={vi.fn()} onCreateList={vi.fn()} onRenameList={vi.fn()} onDeleteList={onDeleteList} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('All tasks in this list will be permanently deleted');
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    expect(onDeleteList).toHaveBeenCalledWith('work');
  });
});