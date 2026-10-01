import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopAccount } from '@/hooks/useDesktopAccount';

afterEach(() => { delete window.hitlistDesktop; });

describe('useDesktopAccount', () => {
  it('is not available in a plain browser', () => {
    const { result } = renderHook(() => useDesktopAccount());
    expect(result.current.available).toBe(false);
    expect(result.current.account).toBeNull();
  });

  it('shows the remembered account, signs in and signs out through the shell', async () => {
    window.hitlistDesktop = {
      getAccount: vi.fn().mockResolvedValue(null),
      signIn: vi.fn().mockResolvedValue({ email: 'a@b.c' }),
      signOut: vi.fn().mockResolvedValue(null),
    };
    const { result } = renderHook(() => useDesktopAccount());
    expect(result.current.available).toBe(true);
    await waitFor(() => expect(window.hitlistDesktop!.getAccount).toHaveBeenCalled());
    expect(result.current.account).toBeNull();
    await act(async () => { await result.current.signIn(); });
    expect(result.current.account).toEqual({ email: 'a@b.c' });
    await act(async () => { await result.current.signOut(); });
    expect(result.current.account).toBeNull();
    expect(window.hitlistDesktop.signOut).toHaveBeenCalled();
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
});
