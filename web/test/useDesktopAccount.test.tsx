import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopPageControls, useDesktopAccount } from '@/hooks/useDesktopAccount';
import { onPreLogout } from '@/lib/preLogout';
import { takeSignOutBackup } from '@/lib/backupMessage';

beforeEach(() => { vi.spyOn(desktopPageControls, 'reload').mockImplementation(() => {}); });
afterEach(() => { delete window.hitlistDesktop; sessionStorage.clear(); vi.restoreAllMocks(); });

describe('useDesktopAccount', () => {
  it('does not clear the account when a pending save fails before logout', async () => {
    window.hitlistDesktop = {
      getAccount: vi.fn().mockResolvedValue({ email: 'a@b.c' }),
      signIn: vi.fn(), signOut: vi.fn(),
    };
    const stop = onPreLogout(async () => { throw new Error('unsaved changes'); });
    try {
      const { result } = renderHook(() => useDesktopAccount());
      await waitFor(() => expect(result.current.account?.email).toBe('a@b.c'));
      await act(async () => { await expect(result.current.signOut()).rejects.toThrow('unsaved changes'); });
      expect(window.hitlistDesktop.signOut).not.toHaveBeenCalled();
      expect(result.current.account?.email).toBe('a@b.c');
      expect(result.current.busy).toBe(false);
    } finally { stop(); }
  });
  it('is not available in a plain browser', () => {
    const { result } = renderHook(() => useDesktopAccount());
    expect(result.current.available).toBe(false);
    expect(result.current.account).toBeNull();
  });

  it('shows the remembered account, signs in and signs out through the shell', async () => {
    window.hitlistDesktop = {
      getAccount: vi.fn().mockResolvedValue(null),
      signIn: vi.fn().mockResolvedValue({ email: 'a@b.c' }),
      signOut: vi.fn().mockResolvedValue({ backup: 'offline' }),
    };
    const { result } = renderHook(() => useDesktopAccount());
    expect(result.current.available).toBe(true);
    await waitFor(() => expect(window.hitlistDesktop!.getAccount).toHaveBeenCalled());
    expect(result.current.account).toBeNull();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.account).toEqual({ email: 'a@b.c' });
    let backupOutcome: string | null = '';
    await act(async () => { backupOutcome = await result.current.signOut(); });
    expect(backupOutcome).toBe('offline');
    expect(result.current.account).toBeNull();
    expect(window.hitlistDesktop.signOut).toHaveBeenCalled();
    expect(desktopPageControls.reload).toHaveBeenCalled();
    expect(takeSignOutBackup()).toBe('offline');
    expect(takeSignOutBackup()).toBeNull();
  });

  it('says so when sign-in fails, and recovers on the next try', async () => {
    window.hitlistDesktop = {
      getAccount: vi.fn().mockResolvedValue(null),
      signIn: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ email: 'x@y.z' }),
      signOut: vi.fn(),
    };
    const { result } = renderHook(() => useDesktopAccount());
    await act(async () => { await result.current.signIn(); });
    expect(result.current.failed).toBe(true);
    await act(async () => { await result.current.signIn(); });
    expect(result.current.failed).toBe(false);
    expect(result.current.account).toEqual({ email: 'x@y.z' });
  });

  it('backs up through the shell and refreshes the last-backup time', async () => {
    const status = vi.fn().mockResolvedValueOnce({ lastSuccessAt: null, lastResult: null }).mockResolvedValue({ lastSuccessAt: 123, lastResult: 'backed-up' });
    window.hitlistDesktop = {
      getAccount: vi.fn().mockResolvedValue({ email: 'a@b.c' }),
      signIn: vi.fn(), signOut: vi.fn(),
      getBackupStatus: status,
      backupNow: vi.fn().mockResolvedValue({ result: 'backed-up', stored: true }),
    };
    const { result } = renderHook(() => useDesktopAccount());
    await waitFor(() => expect(result.current.backup).toEqual({ lastSuccessAt: null, lastResult: null }));
    let outcome = '';
    await act(async () => { outcome = await result.current.backupNow(); });
    expect(outcome).toBe('backed-up');
    expect(result.current.backup?.lastSuccessAt).toBe(123);
    expect(result.current.backingUp).toBe(false);
  });

  it('asks the shell about a restore and runs one, and copes with a shell that cannot', async () => {
    window.hitlistDesktop = {
      getAccount: vi.fn().mockResolvedValue({ email: 'a@b.c' }), signIn: vi.fn(), signOut: vi.fn(),
      checkRestore: vi.fn().mockResolvedValue({ state: 'restore-available', at: 5 }),
      restoreNow: vi.fn().mockResolvedValue({ result: 'restored', imported: { KaizenTasks: 2 } }),
    };
    const { result } = renderHook(() => useDesktopAccount());
    expect(await result.current.checkRestore(true)).toEqual({ state: 'restore-available', at: 5 });
    expect(window.hitlistDesktop.checkRestore).toHaveBeenCalledWith({ force: true });
    expect((await result.current.restoreNow()).result).toBe('restored');

    window.hitlistDesktop = { getAccount: vi.fn().mockResolvedValue(null), signIn: vi.fn(), signOut: vi.fn() };
    const bare = renderHook(() => useDesktopAccount());
    expect((await bare.result.current.checkRestore()).state).toBe('unavailable');
    expect((await bare.result.current.restoreNow()).result).toBe('unavailable');
  });
});
