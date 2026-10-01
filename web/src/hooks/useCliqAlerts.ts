/** The desktop shell's Cliq alert settings, through the calls its preload script exposes. Not available in a browser. */
import { useCallback, useEffect, useState } from 'react';
import type { CliqStatus } from '@/lib/cliqMessage';

interface CliqBridge {
  getCliq?: () => Promise<CliqStatus>;
  setCliq?: (settings: { enabled: boolean; email: string }) => Promise<{ ok: boolean; reason?: string; status: CliqStatus }>;
  testCliq?: () => Promise<{ result: string }>;
}

export function useCliqAlerts() {
  const bridge = typeof window === 'undefined' ? undefined : (window as unknown as { hitlistDesktop?: CliqBridge }).hitlistDesktop;
  const available = !!bridge?.getCliq && !!bridge.setCliq && !!bridge.testCliq;
  const [status, setStatus] = useState<CliqStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge?.getCliq) return;
    try { setStatus(await bridge.getCliq()); } catch { /* the shell is not answering: keep what was shown */ }
  }, [bridge]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Saves the switch and email. Resolves { ok } or { ok: false, reason } (for example 'bad-email'). */
  const save = useCallback(async (settings: { enabled: boolean; email: string }): Promise<{ ok: boolean; reason?: string }> => {
    if (!bridge?.setCliq) return { ok: false, reason: 'unavailable' };
    try {
      const out = await bridge.setCliq(settings);
      setStatus(out.status);
      return { ok: out.ok, reason: out.reason };
    } catch { return { ok: false, reason: 'error' }; }
  }, [bridge]);

  /** Sends the test message; resolves a short code ('sent', 'offline', ...). */
  const test = useCallback(async (): Promise<string> => {
    if (!bridge?.testCliq) return 'unavailable';
    try { return (await bridge.testCliq()).result; } catch { return 'error'; }
  }, [bridge]);

  return { available, status, refresh, save, test };
}
