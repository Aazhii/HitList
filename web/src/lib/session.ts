/**
 * Sign-in for the Catalyst deployment. When the server is in `catalyst` mode, Catalyst's own login decides who a
 * request is from; this only asks the server "am I signed in?" before the app starts, and sends a signed-out
 * browser to Catalyst's hosted login page. In every other build the answer is "yes" and nothing changes.
 */
export interface SessionInfo {
  mode: 'cookie' | 'catalyst';
  authenticated: boolean;
  loginUrl?: string;
  /** Rows brought in from this browser's old cookie workspace on this sign-in, by table. */
  claimed?: Record<string, number>;
}

const CLAIMED_KEY = 'hitlist-claimed';
let current: SessionInfo | null = null;

/** What the server said at startup, or null if it could not be reached. */
export function currentSession(): SessionInfo | null {
  return current;
}

export type SessionOutcome = { kind: 'ready'; session: SessionInfo | null } | { kind: 'login'; url: string };

/**
 * Asks the server who this is. Any failure is "ready": the app has its own offline behaviour, and a sign-in
 * wall must never be what a flaky network turns into a blank page.
 */
export async function resolveSession(fetchJson: () => Promise<SessionInfo>): Promise<SessionOutcome> {
  let session: SessionInfo;
  try {
    session = await fetchJson();
  } catch {
    return { kind: 'ready', session: null };
  }
  current = session;
  if (session.mode === 'catalyst' && !session.authenticated) {
    return { kind: 'login', url: session.loginUrl || '/__catalyst/auth/login' };
  }
  return { kind: 'ready', session };
}

export async function fetchSessionFromServer(): Promise<SessionInfo> {
  const res = await fetch('/api/session', { credentials: 'include' });
  if (!res.ok) throw new Error(`session ${res.status}`);
  return res.json() as Promise<SessionInfo>;
}

/** Remembered across the page load, so the app can say what a first sign-in brought in. */
export function rememberClaimed(claimed: SessionInfo['claimed']): void {
  if (!claimed || Object.keys(claimed).length === 0) return;
  try { sessionStorage.setItem(CLAIMED_KEY, JSON.stringify(claimed)); } catch { /* nothing to show then */ }
}

/** One sentence for the claimed rows, once; null when there is nothing to say. */
export function takeClaimedMessage(): string | null {
  try {
    const raw = sessionStorage.getItem(CLAIMED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CLAIMED_KEY);
    const claimed = JSON.parse(raw) as Record<string, number>;
    const tasks = claimed['KaizenTasks'] ?? 0;
    const notes = claimed['KaizenNotes'] ?? 0;
    const parts = [tasks && `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`, notes && `${notes} ${notes === 1 ? 'note' : 'notes'}`].filter(Boolean);
    const total = Object.values(claimed).reduce((a, b) => a + b, 0);
    return parts.length ? `Brought ${parts.join(' and ')} from this browser into your account.` : `Brought ${total} items from this browser into your account.`;
  } catch { return null; }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(el);
  });
}

/** Ends the Catalyst session and returns to its login page. Uses Catalyst's web SDK, loaded only when needed. */
export async function signOut(loginUrl = '/__catalyst/auth/login'): Promise<void> {
  await loadScript('https://static.zohocdn.com/catalyst/sdk/js/4.6.2/catalystWebSDK.js');
  await loadScript('/__catalyst/sdk/init.js');
  const catalyst = (window as unknown as { catalyst?: { auth?: { signOut?: (redirect: string) => unknown } } }).catalyst;
  if (!catalyst?.auth?.signOut) throw new Error('Catalyst sign-out is not available');
  await catalyst.auth.signOut(loginUrl);
}
