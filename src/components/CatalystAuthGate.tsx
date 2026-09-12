/**
 * CatalystAuthGate — Local app-owned auth gate (v3).
 *
 * Routes: login | register | forgot-password | reset-password
 * No Catalyst/Zoho SDK dependency.
 *
 * Session bootstrap: getSession() is synchronous (localStorage read + expiry
 * check). A brief "sessionLoading" phase prevents any flash of auth screens
 * when the session is valid but the component hasn't painted yet.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Leaf, Loader2 } from 'lucide-react';
import { getSession, logoutUser } from '@/lib/localAuth';
import type { LocalSession } from '@/lib/localAuth';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ForgotPassword } from '@/pages/ForgotPassword';
import { ResetPassword } from '@/pages/ResetPassword';

// ── Auth page routing ─────────────────────────────────────────────────────────
type AuthPage =
  | { id: 'login'; successMessage?: string }
  | { id: 'register' }
  | { id: 'forgot' }
  | { id: 'reset'; token: string };

// ── User context ──────────────────────────────────────────────────────────────
export interface LocalUserContextValue {
  session: LocalSession | null;
  isCatalyst: false;
  signOut: () => void;
  /** Call after emailVerified changes to refresh context */
  refreshSession: () => void;
}

const CatalystUserContext = createContext<LocalUserContextValue>({
  session: null,
  isCatalyst: false,
  signOut: () => {},
  refreshSession: () => {},
});

export function useCatalystUser() {
  return useContext(CatalystUserContext);
}

// ── Auth Gate ─────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
}

export function CatalystAuthGate({ children }: Props) {
  // sessionLoading: true for one microtask tick so the app shell doesn't flash
  // the login screen before the synchronous getSession() result is applied.
  const [sessionLoading, setSessionLoading] = useState(true);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [authPage, setAuthPage] = useState<AuthPage>({ id: 'login' });

  // Bootstrap session on mount (synchronous, but deferred one tick for polish)
  useEffect(() => {
    const s = getSession();
    setSession(s);
    setSessionLoading(false);
  }, []);

  const handleAuthenticated = useCallback((newSession: LocalSession) => {
    setSession(newSession);
  }, []);

  const signOut = useCallback(() => {
    logoutUser();
    setSession(null);
    setAuthPage({ id: 'login' });
  }, []);

  const refreshSession = useCallback(() => {
    setSession(getSession());
  }, []);

  // ── Session bootstrap loading ─────────────────────────────────────────────
  if (sessionLoading) {
    return <AuthLoadingScreen />;
  }

  // ── Not authenticated — show auth screens ─────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-svh bg-background">
        {authPage.id === 'login' && (
          <LoginPage
            onNavigateRegister={() => setAuthPage({ id: 'register' })}
            onNavigateForgot={() => setAuthPage({ id: 'forgot' })}
            onAuthenticated={handleAuthenticated}
            successMessage={authPage.id === 'login' ? authPage.successMessage : undefined}
          />
        )}
        {authPage.id === 'register' && (
          <RegisterPage
            onNavigateLogin={() => setAuthPage({ id: 'login' })}
            onAuthenticated={handleAuthenticated}
          />
        )}
        {authPage.id === 'forgot' && (
          <ForgotPassword
            onNavigateLogin={() => setAuthPage({ id: 'login' })}
            onNavigateReset={(token) => setAuthPage({ id: 'reset', token })}
          />
        )}
        {authPage.id === 'reset' && (
          <ResetPassword
            token={authPage.token}
            onNavigateLogin={(msg) => setAuthPage({ id: 'login', successMessage: msg })}
            onAuthenticated={handleAuthenticated}
          />
        )}
      </div>
    );
  }

  // ── Authenticated — render app ────────────────────────────────────────────
  return (
    <CatalystUserContext.Provider value={{ session, isCatalyst: false, signOut, refreshSession }}>
      {children}
    </CatalystUserContext.Provider>
  );
}

// ── Loading screen ────────────────────────────────────────────────────────────
export function AuthLoadingScreen() {
  return (
    <div className="min-h-svh bg-background flex flex-col items-center justify-center gap-4">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
        <Leaf className="size-6 text-primary" />
      </div>
      <Loader2 className="size-5 text-muted-foreground animate-spin" />
    </div>
  );
}
