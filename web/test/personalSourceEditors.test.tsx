import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteEditor, type NoteTaskLinking } from '@/components/NoteEditor';
import type { DatabaseTaskLinking } from '@/pages/DatabasesPage';
import { TextFieldCell } from '@/components/databases/TextFieldCell';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { listSourceLists } from '@/lib/sharedSource';
import type { NoteBlock } from '@/types/notes';

vi.mock('@/hooks/useWorkspaces', () => ({ useWorkspaces: vi.fn() }));
vi.mock('@/lib/sharedSource', () => ({ listSourceLists: vi.fn() }));
const createTask = vi.fn<(args: Parameters<NoteTaskLinking['createTask']>[0] | Parameters<DatabaseTaskLinking['createTask']>[0]) => ReturnType<NoteTaskLinking['createTask']>>();
const updateBlock = vi.fn();
const linking = {
  lists: [{ id: 'personal-list', name: 'Personal tasks', color: 'blue', createdAt: 1 }], todos: [], tasksLoaded: true,
  createTask, updateTaskTitle: vi.fn(), unlinkTask: vi.fn(), openTask: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  createTask.mockResolvedValue(null);
  vi.mocked(useWorkspaces).mockReturnValue({ available: true, loaded: true, active: null, current: null, me: null, workspaces: [{
    workspaceId: 'team', name: 'Team', role: 'owner', state: 'active', cursor: 0,
    members: [{ userId: 'buddy', name: 'Buddy', email: 'buddy@team.com', role: 'member' }],
  }] });
  vi.mocked(listSourceLists).mockResolvedValue([{ id: 'shared-list', name: 'Team tasks', color: 'blue', listOrder: 0, createdAt: '2026-10-04', updatedAt: '2026-10-04' }]);
});

function Note() {
  const [blocks, setBlocks] = useState<NoteBlock[]>([{ id: 'block', type: 'paragraph', content: 'Plan' }]);
  return <NoteEditor noteId="personal-note" blocks={blocks} linking={linking}
    onUpdateBlock={(id, changes) => { updateBlock(id, changes); setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...changes } : block)); }}
    onAddBlock={() => 'next'} onDeleteBlock={vi.fn()} onChangeBlockType={vi.fn()} onMoveBlock={vi.fn()} />;
}

function Cell() {
  const [value, setValue] = useState('Plan');
  return <TextFieldCell recordId="personal-row" fieldId="personal-field" value={value} ariaLabel="Summary" className="text-[14px]"
    onChange={(next) => setValue(next ?? '')} linking={linking} />;
}

async function assign() {
  const input = screen.getByRole('textbox');
  await userEvent.click(input);
  fireEvent.change(input, { target: { value: 'Plan @buddy', selectionStart: 11 } });
  await userEvent.click(screen.getByRole('combobox', { name: 'Workspace' }));
  await userEvent.click(screen.getByRole('option', { name: 'Team' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add task for Buddy' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Add task for Buddy' }));
}

describe('personal editors with workspace assignment', () => {
  it('passes the workspace and source block without linking the personal note to the snapshot task', async () => {
    render(<Note />);
    await assign();
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'personal-note', blockId: 'block', listId: 'shared-list', assignee: { userId: 'buddy', name: 'Buddy', workspaceId: 'team' } })));
    expect(updateBlock.mock.calls.some((call) => 'taskId' in call[1])).toBe(false);
  });

  it('keeps the cell picker usable during focus transfer and passes the record source', async () => {
    render(<Cell />);
    await assign();
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'personal-row', fieldId: 'personal-field', listId: 'shared-list', assignee: { userId: 'buddy', name: 'Buddy', workspaceId: 'team' } })));
  });
});