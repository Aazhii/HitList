/**
 * The Cliq address automation rules message, and a way to send a test with a rule's own text. Desktop only: in a browser there
 * is no bridge, `available` is false, and the rule builder says messages are sent by the desktop app.
 */
import { useCallback, useEffect, useState } from 'react';

interface Bridge {
  getCliqAddress?: () => Promise<{ email: string | null }>;
  sendCliqMessage?: (text: string) => Promise<{ result: string }>;
}

export function useCliqBot() {
  const bridge = typeof window === 'undefined' ? undefined : (window as unknown as { hitlistDesktop?: Bridge }).hitlistDesktop;
  const available = !!bridge?.getCliqAddress && !!bridge.sendCliqMessage;
  const [email, setEmail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge?.getCliqAddress) return;
    try { setEmail((await bridge.getCliqAddress()).email); } catch { /* keep what was shown */ }
  }, [bridge]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Sends one message to the saved address; resolves a short code ('sent', 'offline', 'bad-email', ...). */
  const sendMessage = useCallback(async (text: string): Promise<string> => {
    if (!bridge?.sendCliqMessage) return 'unavailable';
    try { return (await bridge.sendCliqMessage(text)).result; } catch { return 'error'; }
  }, [bridge]);

  return { available, email, refresh, sendMessage };
}
