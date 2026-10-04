import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareSourceControl } from '@/components/shell/ShareSourceControl';
import { AssignedPage } from '@/pages/AssignedPage';
import { shareSource } from '@/lib/sharedSource';
import { openWorkspace } from '@/lib/workspaceStore';
import { useWorkspaces } from '@/hooks/useWorkspaces';

vi.mock('@/hooks/useWorkspaces', () => ({ useWorkspaces: vi.fn() }));
vi.mock('@/lib/sharedSource', async (original) => ({ ...await original<object>(), shareSource: vi.fn() }));
vi.mock('@/lib/workspaceStore', async (original) => ({ ...await original<object>(), openWorkspace: vi.fn() }));
vi.mock('@/lib/sourceSaves', () => ({ flushSourceSaves: vi.fn(async () => {}) }));

const team = { workspaceId: 'team', name: 'Team', role: 'owner' as const, state: 'active' as const, cursor: 0, members: [
  { userId: 'alice', name: 'Alice', email: 'alice@team.com', role: 'owner' as const },
  { userId: 'bob', name: 'Bob', email: 'bob@team.com', role: 'member' as const },
] };

beforeEach(() => {
  vi.mocked(useWorkspaces).mockReturnValue({ available: true, loaded: true, active: null, me: { userId: 'alice', email: 'alice@team.com' }, workspaces: [team], current: null });
  vi.mocked(shareSource).mockResolvedValue({ kind: 'note', id: 'canonical', recordIds: {}, fieldIds: {} });
  vi.mocked(openWorkspace).mockResolvedValue(true);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('explicit whole-source sharing', () => {
  it('names every member, allows cancel without writes, then flushes before sharing and opens only the canonical ID', async () => {
    let finishSave: () => void = () => {};
    const flush = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    render(<ShareSourceControl kind="note" id="personal" title="Plans" flush={flush} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share source' }));
    const recipients = screen.getByRole('list', { name: 'Source recipients' });
    expect(within(recipients).getByText('Alice')).toBeInTheDocument();
    expect(within(recipients).getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText(/not only the task recipient/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(shareSource).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Share source' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share and open' }));
    expect(flush).toHaveBeenCalledOnce();
    expect(shareSource).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sharing...' })).toBeDisabled();
    await act(async () => finishSave());
    await waitFor(() => expect(shareSource).toHaveBeenCalledWith('team', 'note', 'personal'));
    expect(openWorkspace).toHaveBeenCalledWith('team', '#workspace=team&source=note&id=canonical');
  });

  it('requires confirmation of all database records, columns and values', async () => {
    render(<ShareSourceControl kind="database" id="db" title="Research" />);
    await userEvent.click(screen.getByRole('button', { name: 'Share source' }));
    expect(screen.getByText(/all its records, columns and values/)).toBeInTheDocument();
    expect(shareSource).not.toHaveBeenCalled();
  });

  it('communicates the existing shared boundary without copying again', async () => {
    vi.mocked(useWorkspaces).mockReturnValue({ available: true, loaded: true, active: 'team', me: null, workspaces: [team], current: team });
    render(<ShareSourceControl kind="note" id="canonical" title="Plans" />);
    await userEvent.click(screen.getByRole('button', { name: 'Shared source members' }));
    expect(screen.getByText(/shared with all members of Team/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share and open' })).toBeNull();
    expect(shareSource).not.toHaveBeenCalled();
  });

  it('keeps the personal source open when the explicit save fails', async () => {
    render(<ShareSourceControl kind="note" id="personal" title="Plans" flush={async () => { throw new Error('Pending edit rejected'); }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share source' }));
    await userEvent.click(screen.getByRole('button', { name: 'Share and open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pending edit rejected');
    expect(shareSource).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
  });
});

it('offers source navigation for assigned notes and records, not unrelated tasks', async () => {
  const tasks = [
    { id: 'one', title: 'Note task', status: 'TODO', workspaceId: 'team', workspaceName: 'Team', sourceNoteId: 'canonical' },
    { id: 'two', title: 'Record task', status: 'TODO', workspaceId: 'team', workspaceName: 'Team', sourceRecordId: 'row' },
    { id: 'three', title: 'Plain task', status: 'TODO', workspaceId: 'team', workspaceName: 'Team' },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(tasks))));
  const open = vi.fn();
  render(<AssignedPage onOpen={vi.fn()} onOpenSource={open} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open source note' }));
  expect(open).toHaveBeenLastCalledWith(tasks[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Open source record' }));
  expect(open).toHaveBeenLastCalledWith(tasks[1]);
  expect(screen.getAllByRole('button', { name: /Open source/ })).toHaveLength(2);
});