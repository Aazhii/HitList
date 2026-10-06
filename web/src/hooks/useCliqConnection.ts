import { useCallback, useEffect, useRef, useState } from 'react';

export interface CliqConnectionState {
  available: boolean;
  linked: boolean;
  email: string | null;
  enabled: boolean;
  connected: boolean;
  lastResult: string;
  code?: string;
  expiresAt?: number;
  error?: 'auth-required' | 'account-not-allowed' | 'access-denied' | 'link-conflict' | 'unavailable' | 'workspace-unavailable';
}

interface CliqConnectionBridge {
  getCliqConnection?: () => Promise<CliqConnectionState>;
  startCliqLink?: () => Promise<CliqConnectionState>;
  confirmCliqLink?: () => Promise<CliqConnectionState>;
  setCliqIntake?: (enabled: boolean) => Promise<CliqConnectionState>;
  fetchCliqCommands?: () => Promise<CliqConnectionState>;
  unlinkCliq?: () => Promise<CliqConnectionState>;
}

export function useCliqConnection(open: boolean) {
  const bridge = typeof window === 'undefined' ? undefined : (window as unknown as { hitlistDesktop?: CliqConnectionBridge }).hitlistDesktop;
  const available = !!(bridge?.getCliqConnection && bridge.startCliqLink && bridge.confirmCliqLink
    && bridge.setCliqIntake && bridge.fetchCliqCommands && bridge.unlinkCliq);
  const [state, setState] = useState<CliqConnectionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!available || !bridge?.getCliqConnection) return;
    const request = ++generation.current;
    setState(null);
    setFailed(false);
    try {
      const next = await bridge.getCliqConnection();
      if (request === generation.current) setState(next);
    } catch {
      if (request === generation.current) setFailed(true);
    }
  }, [available, bridge]);

  useEffect(() => {
    if (open) void refresh();
    else { setState(null); setBusy(false); setFailed(false); }
    return () => { generation.current += 1; };
  }, [open, refresh]);

  const run = async (method: 'startCliqLink' | 'confirmCliqLink' | 'fetchCliqCommands' | 'unlinkCliq' | 'setCliqIntake', enabled?: boolean) => {
    if (!open || !available || !bridge) return;
    const request = generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const next = method === 'setCliqIntake'
        ? await bridge.setCliqIntake!(!!enabled)
        : await bridge[method]!();
      if (request === generation.current) setState(next);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };

  return { available, state, busy, failed, run };
}