/**
 * catalystAuth.ts — the app's authentication, backed by Catalyst.
 *
 * Replaces the previous localAuth.ts, which stored accounts and SHA-256
 * password hashes in localStorage. That had three problems worth naming, since
 * they explain why this module exists:
 *
 *   - Accounts never left the browser, so they did not survive a change of
 *     device or even of origin. Registering on the Slate URL and then opening
 *     the AppSail URL reported "No account found".
 *   - Anyone could edit localStorage and be anyone.
 *   - The server could not trust the identity at all, so every row was owned by
 *     a single shared key rather than by its author.
 *
 * Catalyst owns identity now. The browser proves who it is with a session
 * cookie, and the server reads the same identity through the Node SDK, so the
 * two agree by construction.
 *
 * Requires:
 *   - The Web SDK script and /__catalyst/sdk/init.js (see index.html).
 *   - /baas/* proxied to Catalyst — AppSail's init.js sets api_domain:"", so
 *     SDK calls address this app's own origin. See server/catalyst/baasProxy.ts.
 */

// ── SDK surface ───────────────────────────────────────────────────────────────

/** What Catalyst returns for a signed-in app user. */
interface CatalystUserContent {
  user_id?: string | number;
  email_id?: string;
  first_name?: string;
  last_name?: string;
  is_confirmed?: boolean;
  role_details?: { role_name?: string };
}

interface CatalystAuthSdk {
  /**
   * Renders Catalyst's login form as an iframe inside the given element.
   * The element must exist and have a height, or the iframe collapses to
   * nothing and the page looks broken with no error.
   */
  signIn(elementId: string, config?: Record<string, unknown>): void;
  signUp(payload: Record<string, unknown>): Promise<{ status?: number; content?: unknown }>;
  signOut(redirectUrl?: string): void;
  /** Resolves with the user when signed in; REJECTS (401) when not. */
  isUserAuthenticated(): Promise<{ status?: number; content?: CatalystUserContent }>;
}

interface CatalystSdk {
  auth: CatalystAuthSdk;
}

declare global {
  interface Window {
    catalyst?: CatalystSdk;
    /** Set by the init.js loader in index.html once credentials are populated. */
    __catalystInitReady?: boolean;
  }
}

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * The app's view of the signed-in user.
 *
 * Field names match what the previous local session exposed, so the UI did not
 * have to be rewritten around a new shape.
 */
export interface CatalystSession {
  userId: string;
  email: string;
  username: string;
  /** Catalyst only issues sessions to confirmed users, so this is always true. */
  emailVerified: true;
  roleName: string;
}

function toSession(content: CatalystUserContent): CatalystSession | null {
  const id = content.user_id;
  if (id === undefined || id === null || String(id).trim() === '') return null;

  const name = [content.first_name, content.last_name].filter(Boolean).join(' ').trim();
  const email = String(content.email_id ?? '');

  return {
    userId: String(id),
    email,
    username: name || email,
    emailVerified: true,
    roleName: content.role_details?.role_name ?? 'App User',
  };
}

// ── Readiness ─────────────────────────────────────────────────────────────────

/**
 * Waits for the Web SDK and its project credentials.
 *
 * catalystWebSDK.js is a parser-blocking script so window.catalyst exists
 * before React boots, but init.js — which supplies the project id and ZAID — is
 * loaded asynchronously. Calling the SDK before it lands fails in ways that
 * look like network errors.
 */
export function waitForCatalyst(timeoutMs = 8000): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.catalyst && window.__catalystInitReady) return Promise.resolve(true);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.catalyst && window.__catalystInitReady) {
        window.clearInterval(timer);
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        // Resolve rather than reject: the caller shows a diagnosable error
        // screen instead of a blank page.
        resolve(false);
      }
    }, 50);
  });
}

function sdk(): CatalystAuthSdk {
  if (!window.catalyst?.auth) {
    throw new Error('The Catalyst Web SDK is not loaded. Check the script tags in index.html.');
  }
  return window.catalyst.auth;
}

// ── Operations ────────────────────────────────────────────────────────────────

/**
 * Returns the signed-in user, or null.
 *
 * Never throws: the SDK rejects with a 401 when there is no session, which is
 * an ordinary state rather than an error. Note it reports every non-2xx —
 * including that 401 — as `server://net-issue` code 700, so the code cannot be
 * used to tell "signed out" from "unreachable".
 */
export async function getCurrentSession(): Promise<CatalystSession | null> {
  try {
    const res = await sdk().isUserAuthenticated();
    if (res?.content) return toSession(res.content);
    return null;
  } catch {
    return null;
  }
}

/**
 * Renders Catalyst's embedded login form into the given element.
 *
 * Deliberately does NOT pass css_url.
 *
 * That option replaces Catalyst's own stylesheet rather than adding to it, and
 * their sheet is what drives the form's state machine — it hides the steps that
 * are not current. Supplying our own theme removed those rules, so the iframe
 * rendered the email step, "Sign in using OTP", "Forgot Password?", "Change"
 * and the OTP field all at once, stacked and overflowing its container.
 *
 * Styling the interior therefore means starting from Catalyst's published
 * stylesheet and editing it, not writing one from scratch. Until we have that
 * file, the form keeps its default appearance and we style the card around it.
 * A working sign-in beats a themed broken one.
 */
export function renderLoginForm(elementId: string, redirectTo = '/'): void {
  sdk().signIn(elementId, { service_url: redirectTo });
}

export interface SignUpRequest {
  firstName: string;
  lastName: string;
  email: string;
}

export interface SignUpResult {
  ok: boolean;
  error?: string;
}

/**
 * Registers a new app user. Catalyst emails a confirmation link; the account
 * cannot sign in until it is clicked.
 */
export async function signUp(req: SignUpRequest): Promise<SignUpResult> {
  try {
    await sdk().signUp({
      first_name: req.firstName,
      last_name: req.lastName,
      email_id: req.email,
      platform_type: 'web',
      // Catalyst returns the user here after they confirm.
      redirect_url: `${window.location.origin}/`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeAuthError(e) };
  }
}

/** Ends the session and returns to the app, which then shows the login screen. */
export function signOut(): void {
  try {
    sdk().signOut(window.location.origin);
  } catch {
    // Fall back to a reload so the UI cannot be left in a signed-in state.
    window.location.href = '/';
  }
}

/**
 * Turns an SDK rejection into something a person can act on.
 *
 * The SDK reports most failures as `server://net-issue` code 700 regardless of
 * cause, which is worse than useless on a signup form.
 */
export function describeAuthError(e: unknown): string {
  const err = (e ?? {}) as { code?: number; message?: string; content?: { message?: string } };

  const serverMessage = err.content?.message;
  if (serverMessage) return serverMessage;

  if (err.code === 700) {
    return (
      'Catalyst rejected the request. If you are signing up, public signup may be ' +
      'disabled for this project (Console → Authentication → Settings).'
    );
  }
  return err.message || 'Authentication failed. Please try again.';
}
