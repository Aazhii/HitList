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
import { getServerBackend } from '@/lib/api';
import { CatalystLoginPage } from '@/pages/CatalystLoginPage';

export interface CatalystUserContextValue {
  session: CatalystSession | null;
  /** False for a local-only backend (SQLite/JSON-file) — see LOCAL_SESSION below. */
  isCatalyst: boolean;
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

/**
 * The single local user, for backends with no identity provider.
 *
 * `userId` matches LOCAL_DEV_OWNER in server/notes-server.ts exactly — every
 * row a local backend writes is already scoped to that owner, so this session
 * must resolve to the same id for the app's own client-side scoping
 * (setActiveUserId) to agree with what the server persisted.
 */
const LOCAL_SESSION: CatalystSession = {
  userId: 'local-dev-user',
  email: '',
  username: 'Local',
  emailVerified: true,
  roleName: 'local',
};

type Status =
  | { phase: 'loading' }
  | { phase: 'unavailable'; reason: string }
  | { phase: 'ready' };

export function CatalystAuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>({ phase: 'loading' });
  const [session, setSession] = useState<CatalystSession | null>(null);
  // A local-only backend (SQLite or JSON-file) has no SDK session to re-read
  // on focus, and no real account to sign out of. Tracked separately from
  // `session` so those effects can tell the two modes apart.
  const [isLocalBackend, setIsLocalBackend] = useState(false);

  const loadSession = useCallback(async () => {
    // Local-only backends — the desktop app, or `pnpm dev`/`pnpm start` with
    // no Catalyst project linked — have no identity provider to check
    // against. The server already scopes every row to one local owner in
    // that mode (LOCAL_DEV_OWNER in server/notes-server.ts); mirror that here
    // instead of blocking on a Catalyst SDK that was never going to load. A
    // hosted deployment (AppSail/Slate) reports 'catalyst' and falls through
    // to the unchanged flow below.
    const backend = await getServerBackend();
    if (backend && backend !== 'catalyst') {
      setIsLocalBackend(true);
      setSession(LOCAL_SESSION);
      setStatus({ phase: 'ready' });
      return;
    }

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
  // rather than leaving a signed-in user looking at the login form. Skipped
  // for a local backend, which would otherwise overwrite LOCAL_SESSION with
  // whatever an SDK that was never loaded resolves to.
  useEffect(() => {
    if (isLocalBackend) return;
    function onFocus() { void getCurrentSession().then(setSession); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isLocalBackend]);

  const signOut = useCallback(() => {
    // No account to sign out of locally — left as a no-op rather than
    // clearing the session, which would otherwise strand a local user on
    // CatalystLoginPage with no Catalyst project to sign into.
    if (isLocalBackend) return;
    setSession(null);
    catalystSignOut();
  }, [isLocalBackend]);

  const refreshSession = useCallback(() => {
    if (isLocalBackend) return;
    void getCurrentSession().then(setSession);
  }, [isLocalBackend]);

  if (status.phase === 'loading') return <AuthLoadingScreen />;
  if (status.phase === 'unavailable') return <AuthUnavailableScreen reason={status.reason} />;
  if (!session) return <CatalystLoginPage />;

  return (
    <CatalystUserContext.Provider value={{ session, isCatalyst: !isLocalBackend, signOut, refreshSession }}>
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
