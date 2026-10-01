/**
 * The desktop shell's signed-in account (D1), through the three calls its preload script exposes. In a browser, or in
 * a desktop build without them, `available` is false and the menu shows nothing about it.
 */
import { useCallback, useEffect, useState } from 'react';

export interface DesktopAccount { email: string | null }

interface DesktopBridge {
  getAccount: () => Promise<DesktopAccount | null>;
  signIn: () => Promise<DesktopAccount | null>;
  signOut: () => Promise<null>;
}

declare global {
  interface Window { hitlistDesktop?: DesktopBridge }
}

export function useDesktopAccount() {
  const bridge = typeof window === 'undefined' ? undefined : window.hitlistDesktop;
  const [account, setAccount] = useState<DesktopAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void bridge?.getAccount().then((a) => { if (live) setAccount(a); }).catch(() => {});
    return () => { live = false; };
  }, [bridge]);

  const signIn = useCallback(async () => {
    if (!bridge) return;
    setBusy(true); setFailed(false);
    try { setAccount(await bridge.signIn()); } catch { setFailed(true); } finally { setBusy(false); }
  }, [bridge]);

  const signOut = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    try { await bridge.signOut(); setAccount(null); } finally { setBusy(false); }
  }, [bridge]);

  return { available: !!bridge, account, busy, failed, signIn, signOut };
}
