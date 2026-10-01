/**
 * The desktop shell's entire job: start the real API as a local sidecar
 * process (SQLite-backed, no server, no Postgres), wait for it to answer,
 * and show it in a window. Nothing here duplicates app logic — the backend
 * is api/'s own jar unmodified, the UI is web/'s own build unmodified, and
 * reminders are the browser Notification API web/src/hooks/useNotifications.ts
 * already calls, which Electron's Chromium honors natively. There is no
 * background process, no OS-level scheduling, no LaunchAgent: the backend
 * lives exactly as long as this app's own process does.
 */
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { createAuth, ownerFor } = require('./auth');
const { createBackup } = require('./backup');
const { createRestore } = require('./restore');
const { createCliqAlerts } = require('./cliqAlerts');
const { dataDirIn, migrateLegacyData, LEGACY_FOLDER } = require('./dataDir');
const { BACKUP_FUNCTION_URL } = require('./catalyst-config');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 200;

// Linux: newer Ubuntu (24.04 and later) blocks the user-namespace sandbox that Electron uses unless an AppArmor profile
// allows it, and the app then refuses to start at all. Only in that case, start without Chromium's sandbox, so the app opens
// instead of failing. Everywhere else the sandbox stays on. (The .deb sets up its own sandbox helper and is not affected.)
if (process.platform === 'linux') {
  try {
    if (fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1') {
      app.commandLine.appendSwitch('no-sandbox');
    }
  } catch { /* the setting does not exist on this system: leave the sandbox on */ }
}

// One data folder for every way of running the app (installed or from the project). Set before anything reads it,
// including the single-instance lock below, which is keyed on this folder. Data from the folder older project runs used
// is COPIED in once, only if this folder has no database yet; the old folder is left alone.
{
  const appData = app.getPath('appData');
  app.setPath('userData', dataDirIn(appData));
  try {
    const outcome = migrateLegacyData({ legacyDir: path.join(appData, LEGACY_FOLDER), dir: app.getPath('userData') });
    if (outcome === 'copied') console.log('[hitlist] copied your data from the older folder into', app.getPath('userData'));
  } catch (error) {
    console.error('[hitlist] could not copy the older data folder:', error.message);
  }
}

// One instance at a time — two processes writing the same SQLite file at
// once is exactly the kind of corruption SQLite's own docs warn about.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** An unused local port, chosen by the OS — avoids ever colliding with
 * whatever else might be running (the lesson from Slice 1's own port mix-up
 * with a leftover Docker container on 3001). */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * A stable per-install secret, generated once and reused on every launch.
 * Without this, the API mints a fresh signing secret every boot, which
 * invalidates every previously-issued owner cookie — the app would look like
 * it lost your data on every restart, when the data was never gone, just
 * unreachable under an identity nothing points to anymore.
 */
function getOrCreateOwnerSecret(userDataDir) {
  const secretPath = path.join(userDataDir, 'owner-secret.txt');
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

/** Where the packaged app keeps hitlist.jar vs. where this dev checkout does. */
function getJarPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'hitlist.jar')
    : path.join(__dirname, '..', 'api', 'target', 'hitlist.jar');
}

/** Same idea for the Java runtime: a bundled JRE once packaged (Slice 3),
 * the `java` already on PATH during development. */
function getJavaExecutable() {
  if (!app.isPackaged) return process.platform === 'win32' ? 'java.exe' : 'java';
  // The Windows installer bundles Temurin's runtime (bin/java.exe); the Mac build bundles a jlink runtime (bin/java).
  const jre = path.join(process.resourcesPath, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  return fs.existsSync(jre) ? jre : (process.platform === 'win32' ? 'java.exe' : 'java');
}

function waitForHealth(port) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const tryOnce = () => new Promise((resolve) => {
    const req = require('node:http').get(`http://127.0.0.1:${port}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
  });
  return (async function poll() {
    if (await tryOnce()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    return poll();
  })();
}

let backendProcess = null;
/** Set once the window is up. Used by the quit handler to take a last backup. */
let backup = null;
const QUIT_BACKUP_MS = 8000;
/** A secret for this launch only. The local server accepts an account name from the shell only with it. */
const DESKTOP_TOKEN = crypto.randomBytes(32).toString('hex');

function startBackend(port, userDataDir) {
  const jarPath = getJarPath();
  if (!fs.existsSync(jarPath)) {
    throw new Error(`hitlist.jar not found at ${jarPath} — build api/ first (mvn package).`);
  }
  const sqlitePath = path.join(userDataDir, 'hitlist.db');
  const ownerSecret = getOrCreateOwnerSecret(userDataDir);

  backendProcess = spawn(getJavaExecutable(), ['-jar', jarPath], {
    env: {
      ...process.env,
      STORAGE_MODE: 'sqlite',
      SQLITE_PATH: sqlitePath,
      SERVER_PORT: String(port),
      OWNER_COOKIE_SECRET: ownerSecret,
      AUTH_MODE: 'desktop',
      DESKTOP_TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Surfaced on failure only — a healthy backend doesn't need its log
  // narrated, but a silent one that never becomes healthy is undebuggable
  // without this.
  let log = '';
  backendProcess.stdout.on('data', (chunk) => { log += chunk; });
  backendProcess.stderr.on('data', (chunk) => { log += chunk; });
  backendProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[hitlist backend] exited with code ${code}\n${log}`);
    }
  });
}

function stopBackend() {
  return new Promise((resolve) => {
    if (!backendProcess || backendProcess.exitCode !== null) { resolve(); return; }
    backendProcess.once('exit', resolve);
    backendProcess.kill('SIGTERM');
    // A hung JVM shouldn't hold the app open indefinitely.
    setTimeout(() => { if (backendProcess?.exitCode === null) backendProcess.kill('SIGKILL'); }, 5000);
  });
}

async function createWindow() {
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });

  let port;
  try {
    port = await getFreePort();
    startBackend(port, userDataDir);
  } catch (error) {
    dialog.showErrorBox('HitList could not start', String(error?.message ?? error));
    app.quit();
    return;
  }

  const ready = await waitForHealth(port);
  if (!ready) {
    dialog.showErrorBox(
      'HitList could not start',
      'The local backend did not respond in time. Check that Java is installed and try again.',
    );
    await stopBackend();
    app.quit();
    return;
  }

  const auth = createAuth({ userDataDir });
  /** Who is signed in, as remembered on disk: the app opens signed in with no network. */
  let account = auth.cachedAccount();

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'HitList',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });

  // Name the signed-in account on every request the app makes to its own local server, and only to it.
  win.webContents.session.webRequest.onBeforeSendHeaders({ urls: [`http://127.0.0.1:${port}/*`] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    if (account) {
      headers['X-Hitlist-Desktop-Token'] = DESKTOP_TOKEN;
      headers['X-Hitlist-Desktop-Owner'] = ownerFor(account.userId);
    }
    callback({ requestHeaders: headers });
  });

  /** The local server's answer, as the signed-in account (this is where the snapshot comes from). */
  const localGet = (urlPath) => new Promise((resolve, reject) => {
    const headers = account ? { 'X-Hitlist-Desktop-Token': DESKTOP_TOKEN, 'X-Hitlist-Desktop-Owner': ownerFor(account.userId) } : {};
    require('node:http').get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`local ${res.statusCode}`))));
    }).on('error', reject);
  });
  backup = createBackup({
    stateDir: userDataDir,
    getAccount: () => account,
    localGet,
    upload: async (bytes, hash) => {
      const res = await auth.getSession().fetch(`${BACKUP_FUNCTION_URL}/backup`, { method: 'PUT', body: bytes, headers: { 'x-content-hash': hash } });
      return { status: res.status, body: await res.text() };
    },
  });
  backup.startSchedule();

  const localPost = (urlPath, body) => new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const headers = {
      'Content-Type': 'application/json', 'Content-Length': payload.length,
      ...(account ? { 'X-Hitlist-Desktop-Token': DESKTOP_TOKEN, 'X-Hitlist-Desktop-Owner': ownerFor(account.userId) } : {}),
    };
    const req = require('node:http').request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = {}; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject);
    req.end(payload);
  });
  const cloudFetch = (urlPath) => auth.getSession().fetch(`${BACKUP_FUNCTION_URL}${urlPath}`);
  const restore = createRestore({
    getAccount: () => account,
    localGet,
    localPost,
    cloudList: async () => { const res = await cloudFetch('/backup/list'); if (!res.ok) throw new Error(`list ${res.status}`); return res.json(); },
    cloudLatest: async () => { const res = await cloudFetch('/backup/latest'); if (res.status === 404) return null; if (!res.ok) throw new Error(`latest ${res.status}`); return Buffer.from(await res.arrayBuffer()); },
    lastBackupAt: () => backup.status().lastSuccessAt,
  });
  // Cliq alerts: one message when tasks become overdue, sent through the Catalyst Function (which holds the Cliq token).
  const cliqAlerts = createCliqAlerts({
    stateDir: userDataDir,
    getAccount: () => account,
    localGet,
    send: async (urlPath, payload) => {
      const res = await auth.getSession().fetch(`${BACKUP_FUNCTION_URL}${urlPath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      return { status: res.status };
    },
  });
  cliqAlerts.startSchedule();

  /** Set at sign-in, spent by the first check afterwards: that check may look in the cloud even if there is data here. */
  let justSignedIn = false;

  const publicAccount = () => (account ? { email: account.email } : null);
  ipcMain.handle('account:get', () => publicAccount());
  ipcMain.handle('account:signIn', async () => {
    const signedIn = await auth.signIn(win);
    if (signedIn) {
      account = signedIn;
      justSignedIn = true;
      win.webContents.reload();
      // After the page has asked /api/session (which brings the old local workspace into the account), not before.
      setTimeout(() => { void backup.backupNow('signed-in'); }, 15_000);
    }
    return publicAccount();
  });
  ipcMain.handle('restore:check', async (_e, opts) => { const out = await restore.check({ force: !!(opts && opts.force), justSignedIn }); justSignedIn = false; return out; });
  ipcMain.handle('restore:run', () => restore.restore());
  ipcMain.handle('cliq:get', () => cliqAlerts.status());
  ipcMain.handle('cliq:set', (_e, settings) => ({ ...cliqAlerts.setSettings(settings || {}), status: cliqAlerts.status() }));
  ipcMain.handle('cliq:test', () => cliqAlerts.sendTest());
  ipcMain.handle('backup:status', () => backup.status());
  ipcMain.handle('backup:now', () => backup.backupNow('manual'));
  ipcMain.handle('account:signOut', async () => {
    // The pre-logout hook: one last backup first, so signing out does not leave recent work only on this machine. Signing out
    // goes ahead either way (offline included); the page is told how the backup went and says so if it did not.
    const outcome = await Promise.race([
      backup.backupNow('sign-out').catch(() => ({ result: 'error' })),
      new Promise((r) => setTimeout(() => r({ result: 'timeout' }), QUIT_BACKUP_MS)),
    ]);
    await auth.signOut();
    account = null;
    win.webContents.reload();
    return { backup: outcome.result };
  });

  win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', async (event) => {
  if (!backendProcess || backendProcess.exitCode !== null) return;
  event.preventDefault();
  await stopBackend();
  app.quit();
});
