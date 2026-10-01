import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateDialog } from '@/components/shell/UpdateDialog';
import { installHint, updateErrorMessage } from '@/lib/updateMessage';
import type { UpdateStatus } from '@/lib/updateMessage';

const latest = { version: '1.2.0', name: 'HitList 1.2.0', notes: 'Faster Today page', size: 200 * 1024 * 1024 };
const base: UpdateStatus = { current: '1.1.0', phase: 'current', checkedAt: 1, error: null, file: null, latest: null };

function bridge(afterCheck: UpdateStatus) {
  const b = {
    getUpdate: vi.fn(async () => base),
    checkUpdate: vi.fn(async () => afterCheck),
    downloadUpdate: vi.fn(async () => ({ ...afterCheck, phase: 'downloaded' as const, file: '/d/x.dmg' })),
  };
  window.hitlistDesktop = b as unknown as typeof window.hitlistDesktop;
  return b;
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
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('shows the new version with its notes, downloads on request, and says what to do next', async () => {
    const b = bridge({ ...base, phase: 'available', latest });
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Version 1.2.0 is available.')).toBeInTheDocument();
    expect(screen.getByText('Faster Today page')).toBeInTheDocument();
    expect(screen.getByText(/200 MB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download and open' }));
    await waitFor(() => expect(b.downloadUpdate).toHaveBeenCalled());
    expect(await screen.findByText('Downloaded. Open it to install.')).toBeInTheDocument();
    expect(screen.getByText(/Your tasks are kept/)).toBeInTheDocument();
  });

  it('turns a failed check into a plain sentence', async () => {
    bridge({ ...base, phase: 'error', error: 'offline' });
    render(<UpdateDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText(/Could not reach the update server/)).toBeInTheDocument();
  });
});

describe('updateMessage', () => {
  it('explains a rejected download and gives per-computer install steps', () => {
    expect(updateErrorMessage('checksum-mismatch')).toMatch(/thrown away/);
    expect(installHint('MacIntel')).toMatch(/Applications/);
    expect(installHint('Win32')).toMatch(/installer/);
    expect(installHint('Linux x86_64')).toMatch(/AppImage/);
  });
});
