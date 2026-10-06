/** App updates (desktop only): what the shell found on the project's releases, live download progress, and the actions. */
import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatus } from '@/lib/updateMessage';

interface UpdateBridge {
  getUpdate?: () => Promise<UpdateStatus>;
  checkUpdate?: (options?: { force?: boolean }) => Promise<UpdateStatus>;
  findUpdateVersion?: (text: string) => Promise<UpdateStatus>;
  chooseUpdateFile?: () => Promise<UpdateStatus>;
  downloadUpdate?: () => Promise<UpdateStatus>;
  cancelUpdate?: () => Promise<UpdateStatus>;
  installUpdate?: () => Promise<UpdateStatus & { restart?: boolean }>;
  onUpdateProgress?: (listener: (status: UpdateStatus) => void) => () => void;
}

export function useAppUpdate() {
  const bridge = typeof window === 'undefined' ? undefined : (window as unknown as { hitlistDesktop?: UpdateBridge }).hitlistDesktop;
  const visible = !!bridge;
  const available = !!bridge?.getUpdate && !!bridge?.checkUpdate && !!bridge?.downloadUpdate && !!bridge?.installUpdate;
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  const run = useCallback(async (call?: () => Promise<UpdateStatus>) => {
    if (!call) return;
    try { setStatus(await call()); } catch { /* the shell is not answering: keep what was shown */ }
  }, []);

  useEffect(() => { void run(bridge?.getUpdate); }, [bridge, run]);
  // The shell reports progress as it happens; these replace the status without asking.
  useEffect(() => bridge?.onUpdateProgress?.((next) => setStatus(next)), [bridge]);

  const check = useCallback((options?: { force?: boolean }) => run(bridge?.checkUpdate ? () => bridge.checkUpdate!(options) : undefined), [bridge, run]);
  const findVersion = useCallback((text: string) => run(bridge?.findUpdateVersion ? () => bridge.findUpdateVersion!(text) : undefined), [bridge, run]);
  const chooseFile = useCallback(() => run(bridge?.chooseUpdateFile), [bridge, run]);
  const canChoose = !!bridge?.findUpdateVersion && !!bridge?.chooseUpdateFile;
  const download = useCallback(() => run(bridge?.downloadUpdate), [bridge, run]);
  const cancel = useCallback(() => run(bridge?.cancelUpdate), [bridge, run]);
  const install = useCallback(() => run(bridge?.installUpdate), [bridge, run]);
  return { visible, available, status, check, findVersion, chooseFile, canChoose, download, cancel, install };
}
