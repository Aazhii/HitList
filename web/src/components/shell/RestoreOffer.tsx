/**
 * The offer to restore a backup (D4). On the desktop it asks the shell once at startup whether there is something
 * worth offering: the shell only looks in the cloud on an empty install or just after sign-in, so a normal launch costs
 * nothing. The offer is a toast with one button; nothing is restored until it is pressed. Restoring only adds.
 */
import { useEffect } from 'react';
import { toast } from 'sonner';
import { hasRestoreOffer, offerMessage, resultMessage, type RestoreCheck, type RestoreResult } from '@/lib/restoreMessage';

export interface RestoreBridge {
  checkRestore?: (opts?: { force?: boolean }) => Promise<RestoreCheck>;
  restoreNow?: () => Promise<RestoreResult>;
}

/** Shows the offer for a check result, if there is one. Shared by the startup check and the menu entry. */
export function offerRestore(check: RestoreCheck, restoreNow: () => Promise<RestoreResult>): boolean {
  const offer = hasRestoreOffer(check) ? offerMessage(check) : null;
  if (!offer) return false;
  toast(offer.title, {
    duration: Infinity,
    closeButton: true,
    action: {
      label: offer.action,
      onClick: () => {
        void restoreNow().then((result) => {
          toast(resultMessage(result), { duration: 6000 });
          // The pages read their data on load, so a reload is how what came back shows up.
          if (result.result === 'restored') window.setTimeout(() => window.location.reload(), 1500);
        });
      },
    },
  });
  return true;
}

export function RestoreOffer() {
  useEffect(() => {
    const bridge = (window as unknown as { hitlistDesktop?: RestoreBridge }).hitlistDesktop;
    if (!bridge?.checkRestore || !bridge.restoreNow) return;
    const restoreNow = bridge.restoreNow;
    void bridge.checkRestore().then((check) => { offerRestore(check, restoreNow); }).catch(() => {});
  }, []);
  return null;
}
