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
const { app, BrowserWindow, dialog, ipcMain, shell, Notification, powerMonitor } = require('electron');
const { createAuth, ownerFor } = require('./auth');
const { createBackup } = require('./backup');
const { createRestore } = require('./restore');
const { createCliqAlerts } = require('./cliqAlerts');
const { createCliqConnection } = require('./cliqConnection');
const { createUpdater } = require('./updater');
const { createWorkspaceSync } = require('./workspaceSync');
const { createWorkspacePush } = require('./workspacePush');
const installer = require('./installer');
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
  if (!fs.existsSync(jre)) throw new Error('Bundled Java runtime is missing. Reinstall HitList from a complete desktop release.');
  return jre;
}

function waitForHealth(port) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const tryOnce = () => new Promise((resolve) => {
    if (backendStartError) { resolve(false); return; }
    const req = require('node:http').get(`http://127.0.0.1:${port}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
  });
  return (async function poll() {
    if (await tryOnce()) return true;
    if (backendStartError) return false;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    return poll();
  })();
}

let backendProcess = null;
let backendStartError = null;
let backendPort = null;
let windowCreation = null;
/** Set once the window is up. Used by the quit handler to take a last backup. */
let backup = null;
const QUIT_BACKUP_MS = 8000;
/** A secret for this launch only. The local server accepts an account name from the shell only with it. */
const DESKTOP_TOKEN = crypto.randomBytes(32).toString('hex');

function startBackend(port, userDataDir) {
  backendStartError = null;
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
  backendProcess.once('error', (error) => {
    backendStartError = new Error(`Java could not start (${error.code || 'process error'}). Check the bundled runtime and security software permissions.`);
  });
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
    if (!backendProcess || backendStartError || backendProcess.exitCode !== null) { resolve(); return; }
    backendProcess.once('exit', resolve);
    backendProcess.kill('SIGTERM');
    // A hung JVM shouldn't hold the app open indefinitely.
    setTimeout(() => { if (backendProcess?.exitCode === null) backendProcess.kill('SIGKILL'); }, 5000);
  });
}

async function openWindow() {
  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });

  if (!backendProcess || backendProcess.exitCode !== null || backendProcess.killed) {
    backendPort = await getFreePort();
    startBackend(backendPort, userDataDir);
    if (!await waitForHealth(backendPort)) {
      await stopBackend();
      if (backendStartError) throw backendStartError;
      throw new Error('The local backend did not respond in time. Check that Java is installed and try again.');
    }
    if (backendStartError) throw backendStartError;
  }
  const port = backendPort;

  const auth = createAuth({ userDataDir });
  /** Who is signed in, as remembered on disk: the app opens signed in with no network. */
  let account = auth.cachedAccount();
  let accountTransition = false;
  let rendererChanging = false;
  const reloadAccountWindow = () => { rendererChanging = true; win.webContents.reload(); };

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'HitList',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  let connection = null;
  win.on('closed', () => { connection?.stop(); stopBackupSchedule?.(); stopAlertsSchedule?.(); stopUpdateSchedule?.(); });
  let stopBackupSchedule;
  let stopAlertsSchedule;
  let stopUpdateSchedule;

  // The shared workspace the person has open, remembered per account. Task and source-editor requests carry it; account services
  // databases stay personal.
  const activeFile = path.join(userDataDir, 'active-workspace.json');
  const readActive = () => {
    try { const v = JSON.parse(fs.readFileSync(activeFile, 'utf8')); return v && v.userId === account?.userId && /^[A-Za-z0-9_-]{43}$/.test(v.workspaceId) ? v.workspaceId : null; } catch { return null; }
  };
  let activeWorkspace = null;
  const writeActive = (workspaceId) => {
    activeWorkspace = workspaceId;
    try { fs.writeFileSync(activeFile, JSON.stringify({ userId: account?.userId, workspaceId }), { mode: 0o600 }); } catch { /* kept in memory */ }
  };

  // Name the signed-in account on every request the app makes to its own local server, and only to it.
  win.webContents.session.webRequest.onBeforeSendHeaders({ urls: [`http://127.0.0.1:${port}/*`] }, (details, callback) => {
    if ((accountTransition || rendererChanging) && details.method !== 'GET') { callback({ cancel: true }); return; }
    const headers = { ...details.requestHeaders };
    if (account) {
      headers['X-Hitlist-Desktop-Token'] = DESKTOP_TOKEN;
      headers['X-Hitlist-Desktop-Owner'] = ownerFor(account.userId);
      headers['X-Hitlist-Desktop-User'] = account.userId;
      if (activeWorkspace && /^\/api\/(tasks|lists|stats|notes|databases|fields|field-values|views|calendar)(\/|$)/.test(new URL(details.url).pathname)) headers['X-Hitlist-Workspace'] = activeWorkspace;
    }
    callback({ requestHeaders: headers });
  });

  /** The local server's answer, as the signed-in account (this is where the snapshot comes from). */
  const localGet = (urlPath, { accountIdentity = account?.userId, signal, headers: extraHeaders = {} } = {}) => new Promise((resolve, reject) => {
    const headers = accountIdentity
      ? { ...extraHeaders, 'X-Hitlist-Desktop-Token': DESKTOP_TOKEN, 'X-Hitlist-Desktop-Owner': ownerFor(accountIdentity), 'X-Hitlist-Desktop-User': accountIdentity }
      : { ...extraHeaders };
    const req = require('node:http').get({ host: '127.0.0.1', port, path: urlPath, headers, signal }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error(`local ${res.statusCode}`))));
    });
    req.setTimeout?.(10_000, () => req.destroy(new Error('Local request timed out')));
    req.on('error', reject);
  });
  backup = createBackup({
    stateDir: userDataDir,
    getAccount: () => account,
    localGet,
    upload: async (bytes, hash, { accountIdentity, signal, reason }) => {
      if (account?.userId !== accountIdentity || signal.aborted) throw new Error('Account changed');
      const res = await auth.fetchAs(accountIdentity, `${BACKUP_FUNCTION_URL}/backup`, { method: 'PUT', body: bytes, signal, headers: { 'x-content-hash': hash, 'x-backup-reason': reason } }, () => account?.userId === accountIdentity);
      return { status: res.status, body: await res.text() };
    },
  });
  stopBackupSchedule = backup.startSchedule();

  const localPost = (urlPath, body, { accountIdentity = account?.userId, headers: extraHeaders = {}, signal } = {}) => new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const headers = {
      'Content-Type': 'application/json', 'Content-Length': payload.length,
      ...extraHeaders,
      ...(accountIdentity ? { 'X-Hitlist-Desktop-Token': DESKTOP_TOKEN, 'X-Hitlist-Desktop-Owner': ownerFor(accountIdentity), 'X-Hitlist-Desktop-User': accountIdentity } : {}),
    };
    const req = require('node:http').request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', headers, signal }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = {}; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.setTimeout?.(10_000, () => req.destroy(new Error('Local request timed out')));
    req.on('error', reject);
    req.end(payload);
  });
  connection = createCliqConnection({
    stateDir: userDataDir, getAccount: () => account, localGet, localPost,
    cloudPost: async (urlPath, body, { signal } = {}) => {
      const bounded = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(10_000)]);
      const res = await auth.getSession().fetch(`${BACKUP_FUNCTION_URL}${urlPath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: bounded,
      });
      if (!res.ok) {
        const error = new Error('Cliq service unavailable');
        error.status = res.status;
        try {
          const failure = await res.json();
          if (['invalid_account', 'inactive_link'].includes(failure?.error)) error.code = failure.error;
        } catch { }
        throw error;
      }
      return res.json();
    },
    onApplied: () => { if (!win.isDestroyed()) win.webContents.send('cliq:commands-applied'); },
  });
  // Shared workspaces: other members' changes arrive by push (Ably), ours go up in batches; nothing polls.
  const cloudJson = async (method, urlPath, body, { signal } = {}) => {
    const bounded = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(15_000)]);
    const res = await auth.getSession().fetch(`${BACKUP_FUNCTION_URL}${urlPath}`, {
      method, signal: bounded,
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
    });
    let json = {};
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const toPage = (channel, payload) => { if (!win.isDestroyed()) win.webContents.send(channel, payload); };
  const workspaces = createWorkspaceSync({
    stateDir: userDataDir,
    getAccount: () => account,
    localGet, localPost,
    cloud: cloudJson,
    createPush: createWorkspacePush,
    onApplied: (workspaceId) => toPage('workspaces:changed', { workspaceId }),
    onChange: (status) => toPage('workspaces:status', status),
    onAssigned: (info) => {
      toPage('workspaces:assigned', info);
      if (Notification && Notification.isSupported && Notification.isSupported()) {
        new Notification({ title: 'A task was assigned to you', body: info.title }).show();
      }
    },
    fetchTask: async (workspaceId, taskId) => JSON.parse((await localGet(`/api/tasks/${encodeURIComponent(taskId)}`, { headers: { 'X-Hitlist-Workspace': workspaceId } })).toString('utf8')),
  });
  win.on('closed', () => workspaces.stop());
  // Something was just changed in the app: send it. Only writes to tasks or lists count; the engine ignores it when
  // nothing is queued for a shared workspace.
  win.webContents.session.webRequest.onCompleted?.({ urls: [`http://127.0.0.1:${port}/api/*`] }, (details) => {
    if (details.method !== 'GET' && details.statusCode < 300 && /\/api\/(tasks|lists|notes|databases|fields|field-values|sync\/(share-source|source-task))(\/|$|\?)/.test(details.url)) workspaces.kick();
  });
  if (account) { activeWorkspace = readActive(); void workspaces.start(); }
  const cloudFetch = (urlPath) => {
    const identity = account?.userId;
    return auth.fetchAs(identity, `${BACKUP_FUNCTION_URL}${urlPath}`, { signal: AbortSignal.timeout(15_000) }, () => !accountTransition && account?.userId === identity);
  };
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
    getAccount: () => accountTransition ? null : account,
    getWorkspace: () => activeWorkspace,
    localPost,
    send: async (urlPath, payload, { accountIdentity, signal, isCurrent }) => {
      if (!isCurrent() || accountTransition) throw new Error('Account changed');
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const res = await auth.fetchAs(accountIdentity, `${BACKUP_FUNCTION_URL}${urlPath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: bounded,
      }, () => !accountTransition && isCurrent());
      return { status: res.status };
    },
  });
  stopAlertsSchedule = cliqAlerts.startSchedule();
  const resumeAlerts = () => { void cliqAlerts.check().catch(() => {}); };
  powerMonitor?.on('resume', resumeAlerts);
  win.on('closed', () => powerMonitor?.removeListener('resume', resumeAlerts));

  // App updates: look at the project's GitHub Releases, download the new version with progress, then replace the installed app
  // and start it again (installer.js). Where the app cannot be replaced in place, the installer file is opened instead.
  const updatesDir = path.join(userDataDir, 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const swapEnv = { platform: process.platform, exePath: app.getPath('exe'), appImage: process.env.APPIMAGE, isPackaged: app.isPackaged };
  installer.cleanupAfterUpdate({ platform: process.platform, exePath: swapEnv.exePath, helperDir: updatesDir });
  const updater = createUpdater({
    repo: 'Aazhii/HitList',
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    fetch: (url, opts) => fetch(url, opts),
    downloadDir: updatesDir,
    ...(() => { const plan = installer.swapPlan({ ...swapEnv, sameDisk: (p) => { try { return fs.statSync(p).dev === fs.statSync(updatesDir).dev; } catch { return false; } } }); return { canSwap: plan.ok, swapBlock: plan.ok ? null : plan.reason }; })(),
    installFile: ({ file }) => installer.install({ ...swapEnv, file, pid: process.pid, helperDir: updatesDir }),
    openFile: async (file) => { if (process.platform === 'linux') shell.showItemInFolder(file); else await shell.openPath(file); },
    onChange: (s) => { if (!win.isDestroyed()) win.webContents.send('update:progress', s); },
  });
  if (app.isPackaged) stopUpdateSchedule = updater.startSchedule();

  /** Set at sign-in, spent by the first check afterwards: that check may look in the cloud even if there is data here. */
  let justSignedIn = false;

  const publicAccount = () => (account ? { email: account.email, userId: account.userId } : null);
  for (const channel of [
    'account:get', 'account:ready', 'account:signIn', 'account:signOut', 'restore:check', 'restore:run',
    'cliq:get', 'cliq:set', 'cliq:test', 'cliq:address', 'cliq:message', 'update:status', 'update:check', 'update:version', 'update:file',
    'update:download', 'update:cancel', 'update:install', 'backup:status', 'backup:now',
    'cliq:connection:get', 'cliq:connection:start', 'cliq:connection:confirm',
    'cliq:connection:enable', 'cliq:connection:fetch', 'cliq:connection:unlink',
    'ws:refresh', 'ws:active', 'ws:select', 'ws:create', 'ws:invite', 'ws:accept', 'ws:remove', 'ws:leave', 'ws:status',
  ]) ipcMain.removeHandler(channel);
  ipcMain.handle('account:get', () => publicAccount());
  ipcMain.handle('account:ready', (_event, identity) => {
    if (identity !== (account?.userId ?? 'desktop-local-v1')) throw new Error('Renderer account does not match');
    rendererChanging = false;
  });
  const text = (v) => (typeof v === 'string' ? v : '');
  ipcMain.handle('ws:status', () => workspaces.status());
  ipcMain.handle('ws:active', () => ({ workspaceId: activeWorkspace }));
  ipcMain.handle('ws:select', async (_e, o) => {
    const id = typeof o?.workspaceId === 'string' ? o.workspaceId : null;
    if (id === null) { writeActive(null); return { ok: true, workspaceId: null }; }
    let known = [];
    try { known = JSON.parse((await localGet('/api/sync/workspaces')).toString('utf8')); } catch { /* none */ }
    if (!known.some((w) => w.workspaceId === id)) return { ok: false, reason: 'unknown-workspace' };
    writeActive(id);
    return { ok: true, workspaceId: id };
  });
  ipcMain.handle('ws:refresh', async () => { try { await workspaces.refresh(); return { ok: true }; } catch { return { ok: false, reason: 'offline' }; } });
  ipcMain.handle('ws:create', (_e, o) => workspaces.create({ name: text(o?.name), listIds: Array.isArray(o?.listIds) ? o.listIds.filter((x) => typeof x === 'string') : [] }));
  ipcMain.handle('ws:invite', (_e, o) => workspaces.invite(text(o?.workspaceId), text(o?.email)));
  ipcMain.handle('ws:accept', (_e, o) => workspaces.accept(text(o?.token)));
  ipcMain.handle('ws:remove', (_e, o) => workspaces.removeMember(text(o?.workspaceId), text(o?.userId)));
  ipcMain.handle('ws:leave', (_e, o) => workspaces.leave(text(o?.workspaceId)));
  ipcMain.handle('account:signIn', async () => {
    if (accountTransition || account) return publicAccount();
    accountTransition = true;
    cliqAlerts.cancel?.();
    try {
      await backup.cancel();
      const signedIn = await auth.signIn(win);
      if (signedIn) {
        connection.stop();
        workspaces.stop();
        account = signedIn;
        justSignedIn = true;
        reloadAccountWindow();
        const identity = signedIn.userId;
        setTimeout(() => { if (!accountTransition && account?.userId === identity) void backup.backupNow('signed-in'); }, 15_000);
        void connection.get();
        activeWorkspace = readActive();
        void workspaces.start();
      }
      return publicAccount();
    } finally { accountTransition = false; }
  });
  ipcMain.handle('restore:check', async (_e, opts) => { const out = await restore.check({ force: !!(opts && opts.force), justSignedIn }); justSignedIn = false; return out; });
  ipcMain.handle('restore:run', async () => { await connection.beforeRestore(); return restore.restore(); });
  ipcMain.handle('cliq:connection:get', () => connection.get());
  ipcMain.handle('cliq:connection:start', (_e, timeZone) => connection.start(timeZone));
  ipcMain.handle('cliq:connection:confirm', () => connection.confirm());
  ipcMain.handle('cliq:connection:enable', (_e, enabled) => connection.enable(enabled));
  ipcMain.handle('cliq:connection:fetch', () => connection.fetchNow());
  ipcMain.handle('cliq:connection:unlink', () => connection.unlink());
  const alertWorkspace = async (context) => {
    if (accountTransition || !account || (context?.accountId && context.accountId !== account.userId)) throw new Error('Account changed');
    const workspaceId = context?.workspaceId === undefined ? activeWorkspace : context.workspaceId;
    if (workspaceId === null) return null;
    if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(workspaceId)) throw new Error('Unknown workspace');
    const identity = account.userId;
    const known = JSON.parse((await localGet('/api/sync/workspaces', { accountIdentity: identity })).toString('utf8'));
    if (accountTransition || account?.userId !== identity || !known.some((workspace) => workspace.workspaceId === workspaceId)) throw new Error('Unknown workspace');
    return workspaceId;
  };
  ipcMain.handle('cliq:get', async (_e, context) => cliqAlerts.status(await alertWorkspace(context)));
  ipcMain.handle('cliq:set', async (_e, settings) => {
    const identity = account?.userId;
    const workspaceId = await alertWorkspace(settings);
    const out = cliqAlerts.setSettings({ ...settings, workspaceId, accountId: identity });
    return { ...out, status: cliqAlerts.status(workspaceId) };
  });
  ipcMain.handle('cliq:test', async (_e, context) => {
    const identity = account?.userId;
    return cliqAlerts.sendTest(await alertWorkspace(context), identity);
  });
  // Automation rules message the Cliq address saved in Account → Cliq alerts: its address, and a test with the rule's own text.
  ipcMain.handle('cliq:address', () => ({ email: cliqAlerts.addressFor(account?.userId) }));
  ipcMain.handle('cliq:message', (_e, text) => cliqAlerts.sendMessage(typeof text === 'string' ? text : '', account?.userId));
  ipcMain.handle('update:status', () => updater.status());
  ipcMain.handle('update:check', (_e, options) => updater.check({ force: !!(options && options.force) }));
  // A specific version by name, or an installer the person already downloaded (chosen in the system's file dialog).
  ipcMain.handle('update:version', (_e, text) => updater.checkVersion(typeof text === 'string' ? text.slice(0, 80) : ''));
  ipcMain.handle('update:file', async () => {
    const extensions = process.platform === 'darwin' ? ['dmg', 'zip'] : process.platform === 'win32' ? ['exe'] : ['AppImage'];
    const picked = await dialog.showOpenDialog(win, { title: 'Choose a HitList installer', properties: ['openFile'], filters: [{ name: 'HitList installer', extensions }] });
    if (picked.canceled || !picked.filePaths[0]) return updater.status();
    return updater.useFile(picked.filePaths[0]);
  });
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:cancel', () => updater.cancel());
  ipcMain.handle('update:install', async () => {
    // Best effort, like signing out: one last backup so a recent copy exists if anything goes wrong. Never blocks the update.
    await Promise.race([
      backup.backupNow('update').catch(() => null),
      new Promise((r) => setTimeout(r, QUIT_BACKUP_MS)),
    ]);
    const out = await updater.install();
    if (out.restart) setTimeout(() => app.quit(), 300); // the helper takes over once this process has exited
    return out;
  });
  ipcMain.handle('backup:status', () => backup.status());
  ipcMain.handle('backup:now', () => accountTransition ? { result: 'cancelled' } : backup.backupNow('manual'));
  ipcMain.handle('account:signOut', async () => {
    if (accountTransition) throw new Error('Account change already in progress');
    accountTransition = true;
    cliqAlerts.cancel?.();
    let timeout;
    try {
      connection.stop();
      workspaces.stop();
      activeWorkspace = null;
      const outcome = await Promise.race([
        backup.beforeSignOut().catch(() => ({ result: 'error' })),
        new Promise((r) => { timeout = setTimeout(() => r({ result: 'timeout' }), QUIT_BACKUP_MS); }),
      ]);
      await backup.cancel();
      await auth.signOut();
      account = null;
      rendererChanging = true;
      return { backup: outcome.result };
    } finally { clearTimeout(timeout); accountTransition = false; }
  });

  await win.loadURL(`http://127.0.0.1:${port}`);
  void connection.get();
}

function createWindow() {
  if (windowCreation) return windowCreation;
  windowCreation = openWindow().catch((error) => {
    console.error('[hitlist] could not open window:', error);
    dialog.showErrorBox('HitList could not start', String(error?.message ?? error));
    app.quit();
  }).finally(() => { windowCreation = null; });
  return windowCreation;
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('[hitlist] app initialization failed:', error);
  dialog.showErrorBox('HitList could not start', String(error?.message ?? error));
  app.quit();
});

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
