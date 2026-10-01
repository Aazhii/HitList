import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { RestoreOffer, offerRestore } from '@/components/shell/RestoreOffer';

afterEach(() => { delete window.hitlistDesktop; toast.mockClear(); });

describe('RestoreOffer', () => {
  it('does nothing in a browser', () => {
    render(<RestoreOffer />);
    expect(toast).not.toHaveBeenCalled();
  });

  it('offers a restore when the shell finds a backup, and restores only when the button is pressed', async () => {
    const restoreNow = vi.fn().mockResolvedValue({ result: 'offline' });
    window.hitlistDesktop = {
      getAccount: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
      checkRestore: vi.fn().mockResolvedValue({ state: 'restore-available', at: 5 }),
      restoreNow,
    };
    render(<RestoreOffer />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(restoreNow).not.toHaveBeenCalled();
    const [title, options] = toast.mock.calls[0];
    expect(title).toMatch(/backup from .* is available/);
    expect(options.action.label).toBe('Restore');
    options.action.onClick();
    await waitFor(() => expect(restoreNow).toHaveBeenCalled());
  });

  it('shows nothing for states with nothing to offer', () => {
    expect(offerRestore({ state: 'in-sync' }, vi.fn())).toBe(false);
    expect(offerRestore({ state: 'skipped' }, vi.fn())).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
