/** App updates (desktop only): what the shell found on the project's releases, and a way to check and download. */
import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '@/lib/updateMessage';

interface UpdateBridge {
  getUpdate?: () => Promise<UpdateStatus>;
  checkUpdate?: () => Promise<UpdateStatus>;
  downloadUpdate?: () => Promise<UpdateStatus>;
}

export function useAppUpdate() {
  const bridge = typeof window === 'undefined' ? undefined : (window as unknown as { hitlistDesktop?: UpdateBridge }).hitlistDesktop;
  const available = !!bridge?.getUpdate && !!bridge.checkUpdate && !!bridge.downloadUpdate;
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  const run = useCallback(async (call?: () => Promise<UpdateStatus>) => {
    if (!call) return;
    try { setStatus(await call()); } catch { /* the shell is not answering: keep what was shown */ }
  }, []);

  useEffect(() => { void run(bridge?.getUpdate); }, [bridge, run]);

  const check = useCallback(() => run(bridge?.checkUpdate), [bridge, run]);
  const download = useCallback(() => run(bridge?.downloadUpdate), [bridge, run]);
  return { available, status, check, download };
}
