import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useSourceTaskAssignment } from '@/hooks/useSourceTaskAssignment';
import { SourceTaskConfirmation } from '@/components/notes/SourceTaskConfirmation';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { openWorkspace } from '@/lib/workspaceStore';
import { flushSourceSaves } from '@/lib/sourceSaves';
import { sourceTaskRequest, type SourceTaskInput, type SourceTaskResult } from '@/lib/sharedSource';

vi.mock('@/hooks/useWorkspaces', () => ({ useWorkspaces: vi.fn() }));
vi.mock('@/lib/workspaceStore', () => ({ openWorkspace: vi.fn() }));
vi.mock('@/lib/sourceSaves', () => ({ flushSourceSaves: vi.fn() }));
vi.mock('@/lib/sharedSource', async (original) => ({ ...await original<object>(), sourceTaskRequest: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const team = { workspaceId: 'team', name: 'Team', role: 'owner' as const, state: 'active' as const, cursor: 0, members: [
  { userId: 'alice', name: 'Alice', email: 'alice@team.com', role: 'owner' as const },
  { userId: 'bob', name: 'Bob', email: 'bob@team.com', role: 'member' as const },
] };
const input: SourceTaskInput = { workspaceId: 'team', sourceNoteId: 'personal', sourceBlockId: 'block', title: 'Plans', quadrant: 'DO', listId: 'list', assigneeUserId: 'bob' };
const saved = { task: { id: 'task' }, source: { kind: 'note', id: 'canonical', recordIds: {}, fieldIds: {} } } as SourceTaskResult;
const request = vi.fn<() => Promise<SourceTaskResult>>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWorkspaces).mockReturnValue({ available: true, loaded: true, active: null, current: null, me: { userId: 'alice', email: null }, workspaces: [team] });
  vi.mocked(flushSourceSaves).mockResolvedValue(undefined);
  vi.mocked(openWorkspace).mockResolvedValue(true);
  request.mockReset().mockResolvedValue(saved);
  vi.mocked(sourceTaskRequest).mockReturnValue(request);
});

describe('personal source assignment', () => {
  it('waits for pending source saves and ignores concurrent submits', async () => {
    let finishSave: () => void = () => {};
    vi.mocked(flushSourceSaves).mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    const { result } = renderHook(useSourceTaskAssignment);
    let outcome: Promise<null>;
    act(() => { outcome = result.current.createTask(input); });
    await act(async () => { result.current.decide(true); });
    expect(flushSourceSaves).toHaveBeenCalledOnce();
    expect(sourceTaskRequest).not.toHaveBeenCalled();
    await act(async () => { expect(await result.current.createTask(input)).toBeNull(); });
    await act(async () => { finishSave(); await outcome; });
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not create or navigate after unmount during a pending save', async () => {
    let finishSave: () => void = () => {};
    vi.mocked(flushSourceSaves).mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    const { result, unmount } = renderHook(useSourceTaskAssignment);
    let outcome: Promise<null>;
    act(() => { outcome = result.current.createTask(input); });
    await act(async () => { result.current.decide(true); });
    unmount();
    await act(async () => { finishSave(); await outcome; });
    expect(sourceTaskRequest).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it('discloses all members and snapshot boundaries for notes and databases', () => {
    const onDecision = vi.fn();
    const view = render(<SourceTaskConfirmation consent={{ workspace: team, kind: 'note', title: 'Plans' }} onDecision={onDecision} />);
    const members = screen.getByRole('list', { name: 'Source recipients' });
    expect(within(members).getByText('Alice')).toBeInTheDocument();
    expect(within(members).getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText(/does not automatically sync/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDecision).toHaveBeenCalledWith(false);
    view.rerender(<SourceTaskConfirmation consent={{ workspace: team, kind: 'database', title: 'Plans' }} onDecision={onDecision} />);
    expect(screen.getByText(/all records, columns and values/)).toBeInTheDocument();
  });

  it('cancels without flushing or creating, then saves only after confirmation and returns no personal link', async () => {
    const { result } = renderHook(useSourceTaskAssignment);
    let outcome: Promise<null>;
    act(() => { outcome = result.current.createTask(input); });
    expect(result.current.consent?.workspace).toEqual(team);
    expect(flushSourceSaves).not.toHaveBeenCalled();
    await act(async () => { result.current.decide(false); await outcome; });
    expect(sourceTaskRequest).not.toHaveBeenCalled();
    act(() => { outcome = result.current.createTask(input); });
    await act(async () => { result.current.decide(true); expect(await outcome).toBeNull(); });
    expect(flushSourceSaves).toHaveBeenCalledOnce();
    expect(sourceTaskRequest).toHaveBeenCalledWith(input);
    expect(openWorkspace).toHaveBeenCalledWith('team', '#workspace=team&source=note&id=canonical');
  });

  it('reuses the request after uncertain failure and offers open-only recovery once saved', async () => {
    request.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(useSourceTaskAssignment);
    const assign = async () => {
      let outcome: Promise<null>;
      act(() => { outcome = result.current.createTask(input); });
      await act(async () => { result.current.decide(true); await outcome; });
    };
    await assign();
    vi.mocked(openWorkspace).mockResolvedValue(false);
    await assign();
    expect(sourceTaskRequest).toHaveBeenCalledOnce();
    const notification = vi.mocked(toast.error).mock.calls.at(-1)?.[1];
    expect(notification).toMatchObject({ action: { label: 'Open shared source' } });
    const action = notification?.action;
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('Missing recovery action');
    act(() => action.onClick({} as React.MouseEvent<HTMLButtonElement>));
    await waitFor(() => expect(openWorkspace).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('flush failure blocks the API and database opening uses mapped canonical record IDs', async () => {
    const { result } = renderHook(useSourceTaskAssignment);
    vi.mocked(flushSourceSaves).mockRejectedValueOnce(new Error('save failed'));
    let outcome: Promise<null>;
    act(() => { outcome = result.current.createTask(input); });
    await act(async () => { result.current.decide(true); await outcome; });
    expect(sourceTaskRequest).not.toHaveBeenCalled();
    request.mockResolvedValue({ ...saved, source: { kind: 'database', id: 'shared-db', recordIds: { row: 'shared-row' }, fieldIds: { field: 'shared-field' } } });
    act(() => { outcome = result.current.createTask({ ...input, sourceNoteId: undefined, sourceBlockId: undefined, sourceRecordId: 'row', sourceFieldId: 'field' }); });
    await act(async () => { result.current.decide(true); await outcome; });
    expect(openWorkspace).toHaveBeenCalledWith('team', '#workspace=team&source=database&id=shared-db&record=shared-row');
  });
});