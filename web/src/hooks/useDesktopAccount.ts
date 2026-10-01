/**
 * The desktop shell's signed-in account (D1), through the three calls its preload script exposes. In a browser, or in
 * a desktop build without them, `available` is false and the menu shows nothing about it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { RestoreCheck, RestoreResult } from '@/lib/restoreMessage';

export interface DesktopAccount { email: string | null }

export interface BackupStatus { lastSuccessAt: number | null; lastResult: string | null }
export interface BackupOutcome { result: string; stored?: boolean }

interface DesktopBridge {
  getBackupStatus?: () => Promise<BackupStatus>;
  backupNow?: () => Promise<BackupOutcome>;
  checkRestore?: (opts?: { force?: boolean }) => Promise<RestoreCheck>;
  restoreNow?: () => Promise<RestoreResult>;
  getAccount: () => Promise<DesktopAccount | null>;
  signIn: () => Promise<DesktopAccount | null>;
  signOut: () => Promise<{ backup?: string } | null>;
}

declare global {
  interface Window { hitlistDesktop?: DesktopBridge }
}

export function useDesktopAccount() {
  const bridge = typeof window === 'undefined' ? undefined : window.hitlistDesktop;
  const [account, setAccount] = useState<DesktopAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    let live = true;
    void bridge?.getAccount().then((a) => { if (live) setAccount(a); }).catch(() => {});
    void bridge?.getBackupStatus?.().then((b) => { if (live) setBackup(b); }).catch(() => {});
    return () => { live = false; };
  }, [bridge]);

  const signIn = useCallback(async () => {
    if (!bridge) return;
    setBusy(true); setFailed(false);
    try { setAccount(await bridge.signIn()); } catch { setFailed(true); } finally { setBusy(false); }
  }, [bridge]);

  /** Signs out; resolves how the last backup before it went ('backed-up', 'unchanged', 'offline', ...), or null. */
  const signOut = useCallback(async (): Promise<string | null> => {
    if (!bridge) return null;
    setBusy(true);
    try {
      const outcome = await bridge.signOut();
      setAccount(null);
      return outcome?.backup ?? null;
    } finally { setBusy(false); }
    return null;
  }, [bridge]);

  /** Backs up now; returns what happened ('backed-up', 'unchanged', 'offline', 'sign-in-needed', ...). */
  const backupNow = useCallback(async (): Promise<string> => {
    if (!bridge?.backupNow) return 'unavailable';
    setBackingUp(true);
    try {
      const outcome = await bridge.backupNow();
      setBackup(await bridge.getBackupStatus?.() ?? null);
      return outcome.result;
    } catch { return 'error'; } finally { setBackingUp(false); }
  }, [bridge]);

  const checkRestore = useCallback(async (force = false): Promise<RestoreCheck> => {
    if (!bridge?.checkRestore) return { state: 'unavailable' };
    try { return await bridge.checkRestore({ force }); } catch { return { state: 'offline' }; }
  }, [bridge]);

  const restoreNow = useCallback(async (): Promise<RestoreResult> => {
    if (!bridge?.restoreNow) return { result: 'unavailable' };
    try { return await bridge.restoreNow(); } catch { return { result: 'error' }; }
  }, [bridge]);

  return { available: !!bridge, account, busy, failed, signIn, signOut, backup, backingUp, backupNow, checkRestore, restoreNow };
}
