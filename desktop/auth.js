/**
 * Catalyst sign-in for the desktop shell (D1). The hosted login page opens in its own window; when Catalyst lands that
 * window on /app/ the sign-in is done, the window closes itself and the account is remembered in the app's data folder,
 * so the app opens signed in with no network at all. Sign-in is only needed to back up and restore.
 */
const { BrowserWindow, session } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { HOST, LOGIN_URL, SIGNUP_URL, RESET_PASSWORD_URL, BACKUP_FUNCTION_URL } = require('./catalyst-config');

const PARTITION = 'persist:hitlist-catalyst';

/** The same owner id the server derives for a Catalyst user, so the web and desktop paths line up. */
function ownerFor(userId) {
  return crypto.createHash('sha256').update(`catalyst:${userId}`, 'ascii').digest('base64url');
}

/** Where Catalyst sends the window once the person is signed in. */
function isSignedInUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === HOST && (u.pathname === '/app' || u.pathname.startsWith('/app/'));
  } catch { return false; }
}

function createAuth({ userDataDir, getSession = () => session.fromPartition(PARTITION) }) {
  const accountFile = path.join(userDataDir, 'account.json');

  function cachedAccount() {
    try {
      const a = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
      return a && /^[0-9]{5,30}$/.test(String(a.userId)) ? { userId: String(a.userId), email: a.email || null } : null;
    } catch { return null; }
  }
  const remember = (account) => fs.writeFileSync(accountFile, JSON.stringify(account), { mode: 0o600 });

  /** Asks the backup Function who the remembered session belongs to. null = nobody, throws = could not reach it. */
  async function whoami(options = {}) {
    const res = await getSession().fetch(`${BACKUP_FUNCTION_URL}/whoami`, options);
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`whoami ${res.status}`);
    const body = await res.json();
    return /^[0-9]{5,30}$/.test(String(body.userId)) ? { userId: String(body.userId), email: body.email || null } : null;
  }

  async function fetchAs(accountIdentity, url, options = {}, isCurrent = () => true) {
    const verified = await whoami({ signal: options.signal });
    if (!accountIdentity || verified?.userId !== accountIdentity || !isCurrent() || options.signal?.aborted) {
      const error = new Error('Cloud session does not match the local account');
      error.code = 'account-mismatch';
      throw error;
    }
    return getSession().fetch(url, options);
  }

  /** Opens the hosted login. Resolves with the account, or null if the window was closed first. */
  function signIn(parent) {
    return new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        width: 480, height: 720, parent, modal: !!parent, title: 'Sign in to HitList',
        webPreferences: { session: getSession(), contextIsolation: true, nodeIntegration: false },
      });
      let settled = false;
      const finish = async () => {
        if (settled) return;
        settled = true;
        try {
          const account = await whoami();
          if (account) remember(account);
          if (!win.isDestroyed()) win.close();
          resolve(account);
        } catch (error) {
          if (!win.isDestroyed()) win.close();
          reject(error);
        }
      };
      win.webContents.on('did-navigate', (_e, url) => { if (isSignedInUrl(url)) void finish(); });
      win.on('closed', () => { if (!settled) { settled = true; resolve(null); } });
      // A small first screen with three clear choices, then Catalyst's own pages behind them (sign in, sign up, set password).
      void win.loadFile(path.join(__dirname, 'signin.html'), { query: { host: HOST, login: LOGIN_URL, signup: SIGNUP_URL, reset: RESET_PASSWORD_URL } });
    });
  }

  async function signOut() {
    await getSession().clearStorageData();
    fs.rmSync(accountFile, { force: true });
  }

  return { cachedAccount, whoami, fetchAs, signIn, signOut, getSession };
}

module.exports = { createAuth, ownerFor, isSignedInUrl, PARTITION };
