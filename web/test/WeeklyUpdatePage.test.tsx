import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyUpdatePage } from '@/pages/WeeklyUpdatePage';
import { databaseApi, progressApi, type ApiProgressEntry } from '@/lib/api';
import type { PageInfo } from '@/lib/pages';
import type { Todo } from '@/types/todo';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>();
  return {
    ...real,
    progressApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    databaseApi: { ...real.databaseApi, listRows: vi.fn() },
  };
});

const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-05T09:00:00'); // a Monday: the default week is Sep 28-Oct04
const entry = (id: string, text: string, when: string, o: Partial<ApiProgressEntry> = {}): ApiProgressEntry => ({
  id, text, state: 'moved', at: at(when), section: '', taskId: '', noteId: '', recordId: '', createdAt: 0, updatedAt: 0, ...o,
});
const todo = (o: Partial<Todo> & { id: string; text: string }): Todo => ({ status: 'todo', createdAt: 0, listId: 'l1', order: 0, quadrant: 'do', ...o });
const directory: PageInfo[] = [{ kind: 'note', id: 'n1', name: 'Playbook sync', editedAt: at('2026-10-02T10:00:00') }];

const clipboard = { writeText: vi.fn() };
beforeEach(() => {
  localStorage.clear();
  clipboard.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  vi.mocked(databaseApi.listRows).mockResolvedValue([]);
  vi.mocked(progressApi.list).mockResolvedValue([
    entry('a', 'Discussed ZCRM-1058212 with @naga, looping him in', '2026-09-30T11:00:00', { state: 'discussed', section: 'bugs' }),
    entry('b', 'Debugged instance create', '2026-10-01T11:00:00'),
  ]);
});
afterEach(() => vi.clearAllMocks());

const page = (extra: Partial<React.ComponentProps<typeof WeeklyUpdatePage>> = {}) => render(
  <WeeklyUpdatePage now={NOW} todos={[todo({ id: 't', text: 'Webhook flow', status: 'done', completedAt: at('2026-10-02T10:00:00') })]}
    lists={[{ id: 'l1', name: 'Rule engine' }]} directory={directory} logOpen={false} onLogProgress={vi.fn()} {...extra} />,
);

describe('WeeklyUpdatePage', () => {
  it('opens on the week just ended, grouped into the configured sections in order', async () => {
    page();
    expect(await screen.findByText('Discussed ZCRM-1058212 with @naga, looping him in')).toBeInTheDocument();
    expect(screen.getByText('Sep 28-Oct04', { selector: 'span' })).toBeInTheDocument();
    const bugs = screen.getByRole('region', { name: 'Bugs' });
    expect(within(bugs).getByText(/ZCRM-1058212/)).toBeInTheDocument();
    const work = screen.getByRole('region', { name: 'Work Items' });
    expect(within(work).getByText('Debugged instance create')).toBeInTheDocument();
    expect(within(work).getByText('Webhook flow')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Support' })).toBeNull();
    expect(screen.getByText('Playbook sync')).toBeInTheDocument(); // background
  });

  it('copies a prompt that keeps partial progress partial and drops what was unticked', async () => {
    page();
    await screen.findByText('Debugged instance create');
    fireEvent.click(screen.getByLabelText('Include: Debugged instance create'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy the prompt' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
    const text = clipboard.writeText.mock.calls[0][0] as string;
    expect(text).toContain('*Team - Sep 28-Oct04 Weekly Updates*');
    expect(text).toContain('[PARTIAL - discussed, not finished] Sep 30 · Discussed ZCRM-1058212 with @naga, looping him in');
    expect(text).toContain('[DONE] Oct 02 · Webhook flow');
    expect(text).not.toContain('Debugged instance create');
    expect(await screen.findByText('Copied. Paste it into your LLM.')).toBeInTheDocument();
  });

  it('shows the text to copy by hand when the clipboard is not available', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    page();
    await screen.findByText('Debugged instance create');
    fireEvent.click(screen.getByRole('button', { name: 'Copy the prompt' }));
    const box = await screen.findByLabelText('The prompt');
    expect((box as HTMLTextAreaElement).value).toContain('MATERIAL (Sep 28-Oct04)');
  });

  it('moves a line to another section and edits its words', async () => {
    page();
    await screen.findByText('Debugged instance create');
    const row = screen.getByText('Debugged instance create').closest('li') as HTMLElement;
    fireEvent.change(within(row).getByLabelText('Section'), { target: { value: 'support' } });
    expect(progressApi.update).toHaveBeenCalledWith('b', { section: 'support' });
    fireEvent.click(screen.getByText('Debugged instance create'));
    const box = screen.getByLabelText('Edit line');
    fireEvent.change(box, { target: { value: 'Debugged instance create, fix pending' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(progressApi.update).toHaveBeenCalledWith('b', { text: 'Debugged instance create, fix pending' });
  });

  it('says what the page knows and disables copying when nothing was logged or finished', async () => {
    vi.mocked(progressApi.list).mockResolvedValue([]);
    page({ todos: [] });
    expect(await screen.findByTestId('empty-week')).toHaveTextContent(/only knows what you log and what you complete/);
    expect(screen.getByRole('button', { name: 'Copy the prompt' })).toBeDisabled();
  });

  it('asks for the other week and reads it again', async () => {
    page();
    await screen.findByText('Debugged instance create');
    fireEvent.click(screen.getByRole('button', { name: 'This week' }));
    await waitFor(() => expect(progressApi.list).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Oct 5-11', { selector: 'span' })).toBeInTheDocument();
  });

  it('opens the logging dialog', async () => {
    const onLogProgress = vi.fn();
    page({ onLogProgress });
    fireEvent.click(await screen.findByRole('button', { name: 'Log progress' }));
    expect(onLogProgress).toHaveBeenCalled();
  });

  it('keeps edited section names and line prefixes, and mapping rules, for the next visit', async () => {
    const first = page();
    await screen.findByText('Debugged instance create');
    fireEvent.click(screen.getByRole('button', { name: /Sections and examples/ }));
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Squad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a rule' }));
    first.unmount();
    page();
    await screen.findByText('Debugged instance create');
    fireEvent.click(screen.getByRole('button', { name: /Sections and examples/ }));
    expect(screen.getByLabelText('Team name')).toHaveValue('Squad');
    expect(screen.getByLabelText('Rule value')).toHaveValue('Rule engine');
  });
});
