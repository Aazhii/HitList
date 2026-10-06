import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MentionMenu, type MentionMenuHandle } from '@/components/notes/MentionMenu';
import type { KaizenList } from '@/types/todo';
import type { ApiList } from '@/lib/api';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { listSourceLists } from '@/lib/sharedSource';

vi.mock('@/hooks/useWorkspaces', () => ({ useWorkspaces: vi.fn() }));
vi.mock('@/lib/sharedSource', () => ({ listSourceLists: vi.fn() }));

const team = { workspaceId: 'team', name: 'Team', role: 'owner' as const, state: 'active' as const, cursor: 0, members: [
  { userId: 'buddy', name: 'Buddy', email: 'buddy@team.com', role: 'member' as const },
] };
const remoteList = { id: 'team-list', name: 'Team tasks', color: 'blue', listOrder: 0, createdAt: '2026-10-04', updatedAt: '2026-10-04' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWorkspaces).mockReturnValue({ available: false, loaded: true, active: null, me: null, workspaces: [], current: null });
  vi.mocked(listSourceLists).mockResolvedValue([remoteList]);
});

function enableTeams() {
  vi.mocked(useWorkspaces).mockReturnValue({ available: true, loaded: true, active: null, me: null, workspaces: [team, { ...team, workspaceId: 'other', name: 'Other' }, { ...team, workspaceId: 'removed', name: 'Removed', state: 'removed' }], current: null });
}

async function chooseWorkspace(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Workspace' }));
  await userEvent.click(screen.getByRole('option', { name }));
}

const lists: KaizenList[] = [
  { id: 'growth', name: 'Daily Growth', color: 'emerald', createdAt: 1 },
  { id: 'work', name: 'Work Focus', color: 'blue', createdAt: 2 },
  { id: 'side', name: 'Side project', color: 'rose', createdAt: 3 },
];

function setup(props: Partial<React.ComponentProps<typeof MentionMenu>> = {}) {
  const ref = createRef<MentionMenuHandle>();
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <MentionMenu
      ref={ref}
      position={{ top: 10, left: 10 }}
      lists={lists}
      query=""
      pending={false}
      contextLabel="Note block"
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />,
  );
  const key = (k: string) => {
    let used = false;
    act(() => { used = ref.current!.handleKey(k); });
    return used;
  };
  return { ...utils, ref, onSelect, onClose, key };
}

describe('MentionMenu', () => {
  it('selects target members and lists for a personal @buddy assignment', async () => {
    enableTeams();
    const { onSelect, key } = setup({ preferredListId: 'work', query: 'buddy' });
    expect(listSourceLists).not.toHaveBeenCalled();
    await chooseWorkspace('Team');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add task for Buddy' })).toBeEnabled());
    key('Enter');
    expect(onSelect).toHaveBeenCalledWith('team-list', 'schedule', { userId: 'buddy', name: 'Buddy', workspaceId: 'team' });
    expect(listSourceLists).toHaveBeenCalledWith('team');
    expect(screen.getByText(/entire source will be shared/)).toBeInTheDocument();
  });

  it('blocks creation while lists load, handles failure, and can retry', async () => {
    enableTeams();
    vi.mocked(listSourceLists).mockRejectedValueOnce(new Error('Unavailable'));
    const { onSelect } = setup({ query: 'buddy' });
    await chooseWorkspace('Team');
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Add task for Buddy' })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add task for Buddy' })).toBeEnabled());
    expect(listSourceLists).toHaveBeenCalledTimes(2);
  });

  it('ignores late target lists and returns to personal creation without an assignee', async () => {
    enableTeams();
    let finish: (lists: ApiList[]) => void = () => {};
    vi.mocked(listSourceLists).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { key, onSelect } = setup({ preferredListId: 'work', query: 'buddy' });
    await chooseWorkspace('Team');
    expect(screen.getByRole('button', { name: 'Add task for Buddy' })).toBeDisabled();
    await chooseWorkspace('Other');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add task for Buddy' })).toBeEnabled());
    await act(async () => finish([{ ...remoteList, id: 'stale', name: 'Stale' }]));
    key('Enter');
    expect(onSelect).toHaveBeenLastCalledWith('team-list', 'schedule', { userId: 'buddy', name: 'Buddy', workspaceId: 'other' });
    await chooseWorkspace('Personal');
    key('Enter');
    expect(onSelect).toHaveBeenLastCalledWith('work', 'schedule');
  });

  it('keeps already-shared assignment on the current list API path', () => {
    vi.mocked(useWorkspaces).mockReturnValue({ available: true, loaded: true, active: 'team', me: null, workspaces: [team], current: team });
    const { key, onSelect } = setup({ query: 'buddy' });
    key('Enter');
    expect(onSelect).toHaveBeenCalledWith('growth', 'schedule', { userId: 'buddy', name: 'Buddy' });
    expect(listSourceLists).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).toBeNull();
  });

  it('adds with the defaults on ↵: Schedule, in the preferred list', () => {
    const { key, onSelect } = setup({ preferredListId: 'work' });
    expect(screen.getByText('Add this line to a quadrant')).toBeTruthy();
    expect(key('Enter')).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('work', 'schedule');
  });

  it('walks the quadrant grid with the arrow keys', () => {
    const { key, onSelect } = setup({ preferredListId: 'work' });
    key('ArrowLeft');                                   // Do first
    expect(screen.getByRole('radio', { name: /do first/i })).toHaveAttribute('aria-checked', 'true');
    key('ArrowDown');                                   // Delegate, below it
    expect(screen.getByRole('radio', { name: /delegate/i })).toHaveAttribute('aria-checked', 'true');
    key('ArrowRight');                                  // Eliminate
    key('Tab');
    expect(onSelect).toHaveBeenCalledWith('work', 'eliminate');
  });

  it('picks a quadrant by click, and adds from the button', () => {
    const { onSelect } = setup({ preferredListId: 'side' });
    fireEvent.click(screen.getByRole('radio', { name: /delegate/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onSelect).toHaveBeenCalledWith('side', 'delegate');
  });

  it('starts on what was typed after the @', () => {
    const { key, onSelect } = setup({ preferredListId: 'work', query: 'del' });
    key('Enter');
    expect(onSelect).toHaveBeenCalledWith('work', 'delegate');
  });

  it('closes from Cancel and on Escape', () => {
    const { key, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows a message instead of the form when there is nothing to add', () => {
    const { key, onSelect } = setup({ message: 'Write the task in this block first, then type @' });
    expect(screen.getByText(/write the task in this block first/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(key('Enter')).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
