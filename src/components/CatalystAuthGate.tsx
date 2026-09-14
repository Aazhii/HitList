/**
 * CatalystAuthGate — gates the app on a real Catalyst session.
 *
 * Replaces the previous local gate, which read a session out of localStorage.
 * That session was self-asserted: anyone could write one, it never left the
 * browser, and the server could not trust it — which is why every row used to
 * be owned by one shared key instead of by its author.
 *
 * Now the browser proves identity with a Catalyst session cookie, and the
 * server reads that same identity through the Node SDK. Both sides agree
 * without our code having to be trusted.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Leaf, Loader2, AlertCircle } from 'lucide-react';
import {
  waitForCatalyst,
  getCurrentSession,
  signOut as catalystSignOut,
  type CatalystSession,
} from '@/lib/catalystAuth';
import { CatalystLoginPage } from '@/pages/CatalystLoginPage';

export interface CatalystUserContextValue {
  session: CatalystSession | null;
  isCatalyst: true;
  signOut: () => void;
  /** Re-reads the session from Catalyst. */
  refreshSession: () => void;
}

const CatalystUserContext = createContext<CatalystUserContextValue>({
  session: null,
  isCatalyst: true,
  signOut: () => {},
  refreshSession: () => {},
});

export function useCatalystUser() {
  return useContext(CatalystUserContext);
}

type Status =
  | { phase: 'loading' }
  | { phase: 'unavailable'; reason: string }
  | { phase: 'ready' };

export function CatalystAuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>({ phase: 'loading' });
  const [session, setSession] = useState<CatalystSession | null>(null);

  const loadSession = useCallback(async () => {
    // The SDK's credentials arrive asynchronously via init.js; calling before
    // they land fails in ways that look like network errors.
    const ready = await waitForCatalyst();
    if (!ready) {
      setStatus({
        phase: 'unavailable',
        reason:
          'The Catalyst SDK did not initialise. This build must be served by Catalyst ' +
          '(AppSail or Slate) so that /__catalyst/sdk/init.js is available.',
      });
      return;
    }
    setSession(await getCurrentSession());
    setStatus({ phase: 'ready' });
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);

  // Catalyst returns the user to the app after login, so re-check on focus
  // rather than leaving a signed-in user looking at the login form.
  useEffect(() => {
    function onFocus() { void getCurrentSession().then(setSession); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    catalystSignOut();
  }, []);

  const refreshSession = useCallback(() => { void getCurrentSession().then(setSession); }, []);

  if (status.phase === 'loading') return <AuthLoadingScreen />;
  if (status.phase === 'unavailable') return <AuthUnavailableScreen reason={status.reason} />;
  if (!session) return <CatalystLoginPage />;

  return (
    <CatalystUserContext.Provider value={{ session, isCatalyst: true, signOut, refreshSession }}>
      {children}
    </CatalystUserContext.Provider>
  );
}

/**
 * Painted in the same slot as the sign-in screen, so it is capped to the
 * viewport too — a min-height floor here would let the page scroll for the
 * moment before the session resolves.
 */
export function AuthLoadingScreen() {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 overflow-hidden bg-background">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
        <Leaf className="size-6 text-primary" />
      </div>
      <Loader2 className="size-5 text-muted-foreground animate-spin" />
    </div>
  );
}

/**
 * Shown when the SDK never initialises — running `vite` directly, for example,
 * where /__catalyst/sdk/init.js does not exist. Says so plainly instead of
 * leaving a blank screen or an endless spinner.
 */
function AuthUnavailableScreen({ reason }: { reason: string }) {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 overflow-hidden bg-background px-6">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertCircle className="size-6 text-destructive" />
      </div>
      <div className="max-w-md text-center space-y-1">
        <h1 className="font-medium">Sign-in is unavailable</h1>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}
