import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { ShareWorkspaceDialog } from '@/components/shell/ShareWorkspaceDialog';
import { JoinWorkspaceDialog } from '@/components/shell/JoinWorkspaceDialog';
import { MentionMenu } from '@/components/notes/MentionMenu';
import { AssigneeChip } from '@/components/tasks/AssigneeChip';
import { pageControls, refreshWorkspaces, resetWorkspaceStore, type SharedWorkspace } from '@/lib/workspaceStore';

const WS = 'W'.repeat(43);
const TOKEN = 'abcDEF0123456789abcDEF0123456789abcDEF01234';
const ME = '100001';
const team = (over: Partial<SharedWorkspace> = {}): SharedWorkspace => ({
  workspaceId: WS, name: 'Team tasks', role: 'owner', state: 'active', cursor: 3,
  members: [
    { userId: ME, email: 'me@x.com', name: 'Me Myself', role: 'owner' },
    { userId: '200002', email: 'bob@x.com', name: 'Bob', role: 'member' },
  ],
  ...over,
});

function bridge(active: string | null = null, extra: Record<string, unknown> = {}) {
  const b = {
    getAccount: vi.fn(async () => ({ email: 'me@x.com', userId: ME })),
    workspaces: {
      active: vi.fn(async () => ({ workspaceId: active })),
      select: vi.fn(async () => ({ ok: true })),
      refresh: vi.fn(async () => ({ ok: true })),
      create: vi.fn(async () => ({ ok: true, workspace: team() })),
      invite: vi.fn(async () => ({ ok: true, link: `https://app/invite.html?t=${TOKEN}`, token: TOKEN, emailed: true, email: 'eve@x.com' })),
      accept: vi.fn(async () => ({ ok: true, workspace: team() })),
      removeMember: vi.fn(async () => ({ ok: true })),
      leave: vi.fn(async () => ({ ok: true })),
      onChanged: vi.fn(() => () => {}),
      ...extra,
    },
  };
  (window as unknown as { hitlistDesktop: unknown }).hitlistDesktop = b;
  return b;
}
function serve(workspaces: SharedWorkspace[], lists: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/lists') ? lists : workspaces),
  })));
}

beforeEach(() => { resetWorkspaceStore(); pageControls.reload = vi.fn(); });
afterEach(() => { delete (window as unknown as { hitlistDesktop?: unknown }).hitlistDesktop; vi.unstubAllGlobals(); });

describe('WorkspaceSwitcher', () => {
  it('is just the app name where shared workspaces are not available', () => {
    render(<WorkspaceSwitcher />);
    expect(screen.getByText('HitList')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the open workspace and switches to another, reloading the page', async () => {
    const b = bridge(WS);
    serve([team()]);
    render(<WorkspaceSwitcher />);
    const trigger = await screen.findByRole('button', { name: 'Workspace: Team tasks' });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Personal/ }));
    await waitFor(() => expect(b.workspaces.select).toHaveBeenCalledWith({ workspaceId: null }));
    await waitFor(() => expect(pageControls.reload).toHaveBeenCalled());
  });

  it('opens the personal workspace by default and lists shared ones, marking a read-only copy', async () => {
    bridge(null);
    serve([team(), team({ workspaceId: 'X'.repeat(43), name: 'Old team', state: 'removed' })]);
    render(<WorkspaceSwitcher />);
    await userEvent.click(await screen.findByRole('button', { name: 'Workspace: Personal' }));
    expect(await screen.findByRole('menuitem', { name: /Team tasks/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Old team.*read-only/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /New shared workspace/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Members and invites/ })).toBeNull();
  });
});

describe('ShareWorkspaceDialog', () => {
  it('shows the members and lets the owner invite by email, then copy the link', async () => {
    const b = bridge(WS);
    serve([team()]);
    await act(async () => { await refreshWorkspaces(); });
    render(<ShareWorkspaceDialog open onOpenChange={vi.fn()} workspace={team()} />);
    const members = screen.getByRole('list', { name: 'Members' });
    expect(within(members).getByText(/Me Myself \(you\)/)).toBeInTheDocument();
    expect(within(members).getByText('Bob')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Invite by email'), 'eve@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(b.workspaces.invite).toHaveBeenCalledWith({ workspaceId: WS, email: 'eve@x.com' }));
    expect(await screen.findByText('Invite emailed to eve@x.com.')).toBeInTheDocument();
    expect(screen.getByLabelText('Invite link')).toHaveValue(`https://app/invite.html?t=${TOKEN}`);
  });

  it('says so when the email could not be sent, so the link can be shared by hand', async () => {
    bridge(WS, { invite: vi.fn(async () => ({ ok: true, link: 'https://app/i?t=x', token: 'x', emailed: false, email: 'eve@x.com' })) });
    serve([team()]);
    render(<ShareWorkspaceDialog open onOpenChange={vi.fn()} workspace={team()} />);
    await userEvent.type(screen.getByLabelText('Invite by email'), 'eve@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText(/could not be sent to eve@x.com/)).toBeInTheDocument();
  });

  it('shows why an invite failed, in words', async () => {
    bridge(WS, { invite: vi.fn(async () => ({ ok: false, reason: 'email_not_allowed' })) });
    serve([team()]);
    render(<ShareWorkspaceDialog open onOpenChange={vi.fn()} workspace={team()} />);
    await userEvent.type(screen.getByLabelText('Invite by email'), 'eve@gmail.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText(/not allowed in this workspace/)).toBeInTheDocument();
  });

  it('lets only the owner remove a member; a member can leave instead', async () => {
    const b = bridge(WS);
    serve([team()]);
    await act(async () => { await refreshWorkspaces(); });
    const { unmount } = render(<ShareWorkspaceDialog open onOpenChange={vi.fn()} workspace={team()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));
    await waitFor(() => expect(b.workspaces.removeMember).toHaveBeenCalledWith({ workspaceId: WS, userId: '200002' }));
    expect(screen.queryByRole('button', { name: 'Leave workspace' })).toBeNull();
    unmount();

    render(<ShareWorkspaceDialog open onOpenChange={vi.fn()} workspace={team({ role: 'member' })} />);
    expect(screen.queryByLabelText('Invite by email')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Leave workspace' }));
    await waitFor(() => expect(b.workspaces.leave).toHaveBeenCalledWith({ workspaceId: WS }));
  });

  it('creates a workspace from the chosen lists only, and opens it', async () => {
    const b = bridge(null);
    serve([], [{ id: 'l1', name: 'Work' }, { id: 'l2', name: 'Home' }]);
    render(<ShareWorkspaceDialog open onOpenChange={vi.fn()} workspace={null} />);
    expect(await screen.findByLabelText('Work')).not.toBeChecked();
    await userEvent.type(screen.getByLabelText('Name'), 'Team tasks');
    await userEvent.click(screen.getByLabelText('Work'));
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(b.workspaces.create).toHaveBeenCalledWith({ name: 'Team tasks', listIds: ['l1'] }));
    await waitFor(() => expect(b.workspaces.select).toHaveBeenCalledWith({ workspaceId: WS }));
  });
});

describe('JoinWorkspaceDialog', () => {
  it('needs a real invite link, then joins and opens the workspace', async () => {
    const b = bridge(null);
    serve([team()]);
    render(<JoinWorkspaceDialog open onOpenChange={vi.fn()} />);
    const join = screen.getByRole('button', { name: 'Join workspace' });
    expect(join).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Invite link'), 'not a link');
    expect(join).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Invite link'));
    fireEvent.change(screen.getByLabelText('Invite link'), { target: { value: `https://app/invite.html?t=${TOKEN}` } });
    await userEvent.click(join);
    await waitFor(() => expect(b.workspaces.accept).toHaveBeenCalledWith({ token: TOKEN }));
    await waitFor(() => expect(b.workspaces.select).toHaveBeenCalledWith({ workspaceId: WS }));
  });

  it('explains a refused invite', async () => {
    bridge(null, { accept: vi.fn(async () => ({ ok: false, reason: 'wrong_account' })) });
    serve([]);
    render(<JoinWorkspaceDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Invite link'), { target: { value: TOKEN } });
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));
    expect(await screen.findByText(/different email address/)).toBeInTheDocument();
  });
});

describe('the "@" card in a shared workspace', () => {
  const lists = [{ id: 'work', name: 'Work', createdAt: 1, color: 'emerald' }];
  const mount = (query = '', onSelect = vi.fn()) => render(
    <MentionMenu position={{ top: 10, left: 10 }} lists={lists} preferredListId="work" query={query} pending={false} contextLabel="Note block" onSelect={onSelect} onClose={vi.fn()} />,
  );

  it('lists the members, and a typed name picks that person', async () => {
    bridge(WS);
    serve([team()]);
    await act(async () => { await refreshWorkspaces(); });
    const onSelect = vi.fn();
    mount('bo', onSelect);
    const group = screen.getByRole('radiogroup', { name: 'Assign to' });
    expect(within(group).getByRole('radio', { name: /Bob/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: /Me Myself \(you\)/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add task for Bob' }));
    expect(onSelect).toHaveBeenCalledWith('work', 'schedule', { userId: '200002', name: 'Bob' });
  });

  it('adds with no one assigned when nobody is picked', async () => {
    bridge(WS);
    serve([team()]);
    await act(async () => { await refreshWorkspaces(); });
    const onSelect = vi.fn();
    mount('', onSelect);
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onSelect).toHaveBeenCalledWith('work', 'schedule');
  });

  it('shows no people in a personal workspace', async () => {
    bridge(null);
    serve([team()]);
    await act(async () => { await refreshWorkspaces(); });
    mount();
    expect(screen.queryByRole('radiogroup', { name: 'Assign to' })).toBeNull();
  });
});

describe('AssigneeChip', () => {
  it('shows nothing for an unassigned task, the name for others, and "You" for you', async () => {
    bridge(WS);
    serve([team()]);
    await act(async () => { await refreshWorkspaces(); });
    const { container, rerender } = render(<AssigneeChip />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AssigneeChip userId="200002" name="Bob" />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
    rerender(<AssigneeChip userId={ME} name="Me Myself" />);
    expect(screen.getByText('You')).toBeInTheDocument();
  });
});
