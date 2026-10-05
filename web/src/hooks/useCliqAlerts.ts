/** The desktop shell's Cliq alert settings, through the calls its preload script exposes. Not available in a browser. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CliqStatus } from '@/lib/cliqMessage';

interface AlertContext { workspaceId: string | null; accountId?: string }
interface CliqBridge {
  getCliq?: (context: AlertContext) => Promise<CliqStatus>;
  setCliq?: (settings: AlertContext & { enabled: boolean; email: string }) => Promise<{ ok: boolean; reason?: string; status: CliqStatus }>;
  testCliq?: (context: AlertContext) => Promise<{ result: string }>;
}

export function useCliqAlerts(workspaceId: string | null = null, accountId?: string) {
  const bridge = typeof window === 'undefined' ? undefined : (window as unknown as { hitlistDesktop?: CliqBridge }).hitlistDesktop;
  const available = !!bridge?.getCliq && !!bridge.setCliq && !!bridge.testCliq;
  const [status, setStatus] = useState<CliqStatus | null>(null);
  const generation = useRef(0);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    if (!bridge?.getCliq) return;
    const epoch = ++generation.current;
    try {
      const value = await bridge.getCliq({ workspaceId, accountId });
      if (generation.current === epoch) { setStatus(value); setFailed(false); }
    } catch { if (generation.current === epoch) setFailed(true); }
  }, [bridge, workspaceId, accountId]);

  useEffect(() => {
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);

  /** Saves the switch and email. Resolves { ok } or { ok: false, reason } (for example 'bad-email'). */
  const save = useCallback(async (settings: { enabled: boolean; email: string }): Promise<{ ok: boolean; reason?: string }> => {
    if (!bridge?.setCliq) return { ok: false, reason: 'unavailable' };
    const epoch = ++generation.current;
    try {
      const out = await bridge.setCliq({ ...settings, workspaceId, accountId: accountId ?? status?.accountId ?? undefined });
      if (generation.current !== epoch) return { ok: false, reason: 'cancelled' };
      setStatus(out.status);
      return { ok: out.ok, reason: out.reason };
    } catch { return { ok: false, reason: 'error' }; }
  }, [bridge, workspaceId, accountId, status]);

  /** Sends the test message; resolves a short code ('sent', 'offline', ...). */
  const test = useCallback(async (): Promise<string> => {
    if (!bridge?.testCliq) return 'unavailable';
    try { return (await bridge.testCliq({ workspaceId, accountId: accountId ?? status?.accountId ?? undefined })).result; } catch { return 'error'; }
  }, [bridge, workspaceId, accountId, status]);

  return { available, status, failed, refresh, save, test };
}
