import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogProgressDialog } from '@/components/worklog/LogProgressDialog';
import { progressApi } from '@/lib/api';

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>();
  return { ...real, progressApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } };
});
const api = vi.mocked(progressApi);

beforeEach(() => {
  localStorage.clear();
  api.list.mockResolvedValue([]);
  api.create.mockImplementation(async (i) => ({
    id: i.clientId ?? 'x', text: i.text, state: i.state ?? 'moved', at: i.at ?? 0, section: '', taskId: i.taskId ?? '',
    noteId: '', recordId: '', createdAt: 0, updatedAt: 0,
  }));
});
afterEach(() => vi.clearAllMocks());

const type = (text: string) => {
  const box = screen.getByLabelText('Progress line');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
};

describe('LogProgressDialog', () => {
  it('saves a line verbatim on Enter, clears the box and stays open', async () => {
    const onOpenChange = vi.fn();
    render(<LogProgressDialog open onOpenChange={onOpenChange} />);
    type('Discussed ZCRM-1058212 with @naga, [thread](https://x.test/a), still open');
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][0]).toMatchObject({ text: 'Discussed ZCRM-1058212 with @naga, [thread](https://x.test/a), still open', state: 'moved' });
    expect(screen.getByLabelText('Progress line')).toHaveValue('');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(await screen.findByText(/Discussed ZCRM-1058212/)).toBeInTheDocument();
  });

  it('saves nothing for a blank line and uses the chosen state and task', async () => {
    render(<LogProgressDialog open onOpenChange={vi.fn()} task={{ id: 't1', title: 'Fix merge' }} />);
    type('   ');
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Blocked' }));
    type('Waiting on the API team');
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toMatchObject({ state: 'blocked', taskId: 't1' });
    expect(screen.getByText('Fix merge')).toBeInTheDocument();
  });

  it('keeps a line when the server cannot be reached, says so, and sends it on the next load', async () => {
    api.create.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    const first = render(<LogProgressDialog open onOpenChange={vi.fn()} />);
    type('Looped in the playbook team');
    expect(await screen.findByText(/saved on this computer/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('hitlist-progress-pending-v1')!)).toHaveLength(1);
    first.unmount();
    render(<LogProgressDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/saved on this computer/)).toBeNull());
  });

  it('does not throw away a line when the session has expired', async () => {
    api.create.mockRejectedValue(Object.assign(new Error('signed out'), { status: 401 }));
    render(<LogProgressDialog open onOpenChange={vi.fn()} />);
    type('Reviewed the rule engine design');
    expect(await screen.findByText(/saved on this computer/)).toBeInTheDocument();
  });
});
