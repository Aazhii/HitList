import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateDialog } from '@/components/shell/UpdateDialog';
import { installHint, percentOf, progressLabel, updateErrorMessage, updateSteps } from '@/lib/updateMessage';
import type { UpdateStatus } from '@/lib/updateMessage';

const latest = { version: '1.2.0', name: 'HitList 1.2.0', notes: 'Faster Today page', size: 200 * 1024 * 1024 };
const base: UpdateStatus = { current: '1.1.0', phase: 'current', checkedAt: 1, error: null, file: null, progress: null, mode: null, latest: null };
const available: UpdateStatus = { ...base, phase: 'available', mode: 'swap', latest };

function bridge(afterCheck: UpdateStatus, extra: Record<string, unknown> = {}) {
  let push: ((s: UpdateStatus) => void) | null = null;
  const b = {
    getUpdate: vi.fn(async () => base),
    checkUpdate: vi.fn(async () => afterCheck),
    downloadUpdate: vi.fn(async () => ({ ...afterCheck, phase: 'ready' as const, file: '/d/x.zip' })),
    cancelUpdate: vi.fn(async () => afterCheck),
    installUpdate: vi.fn(async () => ({ ...afterCheck, phase: 'installing' as const, restart: true })),
    onUpdateProgress: vi.fn((listener: (s: UpdateStatus) => void) => { push = listener; return () => { push = null; }; }),
    ...extra,
  };
  window.hitlistDesktop = b as unknown as typeof window.hitlistDesktop;
  return { ...b, push: (s: UpdateStatus) => act(() => { push?.(s); }) };
}

afterEach(() => { delete window.hitlistDesktop; });

describe('UpdateDialog', () => {
  it('says it belongs to the desktop app in a browser', () => {
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/part of the HitList desktop app/)).toBeInTheDocument();
  });

  it('checks on open and says when up to date', async () => {
    const b = bridge(base);
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('HitList is up to date.')).toBeInTheDocument();
    expect(b.checkUpdate).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('shows the new version with its notes and a Download button', async () => {
    const b = bridge(available);
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Version 1.2.0 is available.')).toBeInTheDocument();
    expect(screen.getByText('Faster Today page')).toBeInTheDocument();
    expect(screen.getByText(/200 MB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(b.downloadUpdate).toHaveBeenCalled());
  });

  it('shows a progress bar that follows what the shell reports, then the restart step', async () => {
    const b = bridge(available);
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    await screen.findByText('Version 1.2.0 is available.');

    b.push({ ...available, phase: 'downloading', progress: { received: 42 * 1024 * 1024, total: 200 * 1024 * 1024 } });
    const bar = await screen.findByRole('progressbar', { name: 'Download progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '21');
    expect(screen.getByText('42 of 200 MB (21%)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    b.push({ ...available, phase: 'verifying', progress: { received: 200 * 1024 * 1024, total: 200 * 1024 * 1024 } });
    expect(await screen.findByText('Checking the download…')).toBeInTheDocument();

    b.push({ ...available, phase: 'ready', file: '/d/x.zip', progress: { received: 200 * 1024 * 1024, total: 200 * 1024 * 1024 } });
    expect(await screen.findByText('Ready to install. HitList will restart.')).toBeInTheDocument();
    expect(screen.getByText(/Your tasks are kept/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }));
    await waitFor(() => expect(b.installUpdate).toHaveBeenCalled());
  });

  it('can cancel a download in progress', async () => {
    const b = bridge(available);
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    await screen.findByText('Version 1.2.0 is available.');
    b.push({ ...available, phase: 'downloading', progress: { received: 1, total: 100 } });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(b.cancelUpdate).toHaveBeenCalled());
  });

  it('Later closes the screen and keeps the download for next time', async () => {
    const b = bridge({ ...available, phase: 'ready', file: '/d/x.zip' });
    const close = vi.fn();
    render(<UpdateDialog open onOpenChange={close} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(b.installUpdate).not.toHaveBeenCalled();
  });

  it('where the app cannot replace itself, the last step opens the installer and says what to do', async () => {
    bridge({ ...available, mode: 'open', phase: 'ready', file: '/d/x.dmg' });
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Downloaded. Open it to install.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open installer' })).toBeInTheDocument();
    expect(screen.getByText(/Your tasks are kept/)).toBeInTheDocument();
  });

  it('a failed download names the reason and offers Try again', async () => {
    const b = bridge({ ...available, phase: 'error', error: 'checksum-mismatch' });
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/did not match its checksum/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(b.downloadUpdate).toHaveBeenCalled());
  });

  it('turns a failed check into a plain sentence', async () => {
    bridge({ ...base, phase: 'error', error: 'offline' });
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/Could not reach the update server/)).toBeInTheDocument();
  });
});

describe('updateMessage', () => {
  it('works out percentages and labels', () => {
    expect(percentOf({ received: 50, total: 200 })).toBe(25);
    expect(percentOf({ received: 5, total: 0 })).toBeNull();
    expect(percentOf(null)).toBeNull();
    expect(progressLabel({ received: 3 * 1024 * 1024, total: 6 * 1024 * 1024 })).toBe('3.0 of 6.0 MB (50%)');
  });

  it('marks each step as waiting, working, done or failed', () => {
    expect(updateSteps({ ...available, phase: 'downloading' })).toEqual({ download: 'active', verify: 'todo', install: 'todo' });
    expect(updateSteps({ ...available, phase: 'verifying' })).toEqual({ download: 'done', verify: 'active', install: 'todo' });
    expect(updateSteps({ ...available, phase: 'installing' })).toEqual({ download: 'done', verify: 'done', install: 'active' });
    expect(updateSteps({ ...available, phase: 'error', error: 'checksum-mismatch' })).toEqual({ download: 'done', verify: 'failed', install: 'todo' });
    expect(updateSteps({ ...available, phase: 'error', error: 'offline' }).download).toBe('failed');
    expect(updateSteps({ ...available, phase: 'ready', error: 'unpack-failed' }).install).toBe('failed');
  });

  it('explains problems and gives per-computer install steps for the by-hand case', () => {
    expect(updateErrorMessage('checksum-mismatch')).toMatch(/thrown away/);
    expect(updateErrorMessage('unpack-failed')).toMatch(/by hand/);
    expect(installHint('MacIntel')).toMatch(/Applications/);
    expect(installHint('Win32')).toMatch(/installer/);
    expect(installHint('Linux x86_64')).toMatch(/AppImage/);
  });
});
