/**
 * Electron main process.
 *
 * Two workflows, kept deliberately distinct (see docs/desktop-app.md):
 *
 *   Development (`pnpm electron:dev`)
 *     Loads the Vite dev server directly (default http://localhost:9000,
 *     already proxying /api to the `pnpm dev` server on :3001 — see
 *     vite.config.ts). This process spawns nothing; it waits for that dev
 *     stack to answer /api/health and points a window at it. Run `pnpm dev`
 *     first.
 *
 *   Production (packaged .app, or `pnpm electron:preview`)
 *     Spawns the bundled server (electron/dist/server.cjs — server/
 *     compiled by scripts/build-electron.mjs) as a child process with
 *     KAIZEN_STORE=sqlite pointed at a database under
 *     app.getPath('userData'), on a freshly chosen free port. Waits for
 *     /api/health, then loads that same origin — so the renderer's existing
 *     relative /api/* calls work completely unchanged from the web build.
 *
 * Single-instance: a second launch focuses the first instance's window
 * instead of spawning a second server against the same SQLite file (two
 * writers is what WAL mode and the queue's claim tokens are built to survive,
 * per notifications/scheduler.ts — but there is no reason to pay that cost
 * for an ordinary Dock re-launch).
 */
import { app, BrowserWindow, Menu, Notification, dialog, session, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { sqlitePathFor } from './shared.ts';
import { installLaunchAgent, uninstallLaunchAgent, launchAgentInstalled } from './launchAgent.ts';

const isDev = !app.isPackaged && process.env['KAIZEN_ELECTRON_FORCE_PROD'] !== '1';
const DEV_UI_URL = process.env['KAIZEN_ELECTRON_DEV_URL'] ?? 'http://localhost:9000';
const HEALTH_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 300;
/** How often the main process polls the inbox for a native-notification banner. See startNotificationPoll. */
const NOTIFICATION_POLL_MS = 30_000;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverOrigin: string | null = null;

app.setName('HitList');

// ── Single instance ───────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(main).catch((error: unknown) => {
    console.error('[electron] startup failed:', error);
    dialog.showErrorBox('HitList failed to start', String(error));
    app.quit();
  });

  app.on('window-all-closed', () => {
    // macOS convention: the app (and its local server, so reminders keep
    // being swept) stays running from the Dock/menu bar until the user quits
    // explicitly. Other platforms are not a packaging target today (see
    // docs/desktop-app.md) but this keeps the fallback honest if that changes.
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverOrigin) createMainWindow(serverOrigin);
  });

  app.on('before-quit', () => {
    if (serverProcess && !serverProcess.killed) serverProcess.kill();
  });
}

async function main(): Promise<void> {
  applySecurityDefaults();
  buildMenu();

  serverOrigin = isDev ? DEV_UI_URL : await startProductionServer();
  await waitForHealth(serverOrigin);
  createMainWindow(serverOrigin);
  // Automation/rule-triggered reminders land in KaizenNotifications via the
  // in-app channel but otherwise only surface in the bell UI; this gives them
  // a native banner too while the app is open. Client-scheduled per-task
  // reminders (src/lib/notifications.ts) already get one for free — Chromium
  // maps the standard web Notification() API to native notifications with no
  // extra code, contextIsolation or not.
  startNotificationPoll(serverOrigin);
}

// ── Security ──────────────────────────────────────────────────────────────────

/**
 * Applied once, app-wide, to every WebContents this process ever creates
 * (including the main window's) — not repeated per-window, so a future
 * window can't be added without these defaults.
 */
function applySecurityDefaults(): void {
  app.on('web-contents-created', (_event, contents) => {
    // The app only ever needs to be on its own local-server origin. Anything
    // else — a link inside a task note, for instance — opens in the user's
    // default browser instead of navigating this window away from localhost.
    contents.on('will-navigate', (event, url) => {
      if (serverOrigin && !url.startsWith(serverOrigin)) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    });
    // window.open() and target="_blank" never get a second BrowserWindow —
    // Electron's own recommended default. Open externally instead.
    contents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  // The renderer's only real use of a permission-gated API is Notification
  // (see src/lib/notifications.ts); everything else the app never asks for.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'notifications');
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

function createMainWindow(origin: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'HitList',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Shown only once the page has actually painted, so the window never
  // flashes blank before the SPA renders.
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  void mainWindow.loadURL(origin);
}

// ── Production server ─────────────────────────────────────────────────────────

/** Binds to port 0 to ask the OS for a free port, then releases it immediately. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error('Could not determine a free port')));
      }
    });
  });
}

/**
 * Spawns the bundled server as a child process and returns its origin.
 *
 * Runs the packaged app's own executable with ELECTRON_RUN_AS_NODE=1 rather
 * than requiring a system Node install — the same trick electron/launchAgent.ts
 * uses for the background sweep. KAIZEN_STORE=sqlite and KAIZEN_SQLITE_PATH
 * point the server (server/store/runtime.ts, server/store/sqlite.ts) at a
 * database under this app's own userData directory, never at the repo's
 * .local/hitlist.sqlite dev path.
 */
async function startProductionServer(): Promise<string> {
  const port = await findFreePort();
  const sqlitePath = sqlitePathFor(app.getPath('userData'));
  const serverScript = path.join(__dirname, 'server.cjs');

  serverProcess = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      KAIZEN_STORE: 'sqlite',
      KAIZEN_SQLITE_PATH: sqlitePath,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    console.log(`[server] ${chunk.toString().trimEnd()}`);
  });
  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    console.error(`[server] ${chunk.toString().trimEnd()}`);
  });
  serverProcess.on('exit', (code) => {
    console.error(`[electron] server process exited with code ${code}`);
    serverProcess = null;
  });

  return `http://127.0.0.1:${port}`;
}

/** Polls /api/health until it answers ok, or throws once HEALTH_TIMEOUT_MS has passed. */
async function waitForHealth(origin: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.json().catch(() => null) as { ok?: boolean } | null;
        if (body?.ok === true) return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  throw new Error(
    isDev
      ? `Could not reach the dev server at ${origin}/api/health. Run "pnpm dev" first, then relaunch Electron.`
      : `The local server did not become healthy in time: ${String(lastError ?? 'timed out')}`,
  );
}

// ── Native notifications for server-delivered reminders ─────────────────────

/**
 * Polls GET /api/notifications for entries newer than the last poll and
 * shows one native Notification per entry, while the app is running.
 *
 * A cursor (highest CreatedAt seen) rather than unread state, so marking a
 * notification read in the UI never causes it to be (re-)announced. The
 * cursor starts at "now" — entries already sitting in the inbox when the app
 * opens (e.g. delivered by the LaunchAgent sweep while it was closed) are not
 * re-announced here; the LaunchAgent runner already gave those their own
 * best-effort banner (see electron/reminder-sweep.ts) and the bell shows them
 * regardless.
 */
function startNotificationPoll(origin: string): void {
  let sinceMs = Date.now();

  const tick = async (): Promise<void> => {
    try {
      const res = await fetch(`${origin}/api/notifications`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const entries = await res.json() as Array<{ id: string; title: string; body: string; createdAt: number }>;
      // Oldest first, so a burst announces in the order it happened.
      const fresh = entries.filter((entry) => entry.createdAt > sinceMs).sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of fresh) {
        sinceMs = Math.max(sinceMs, entry.createdAt);
        if (!Notification.isSupported()) continue;
        const notification = new Notification({
          title: entry.title || 'HitList',
          body: entry.body || '',
        });
        notification.on('click', () => {
          if (!mainWindow) { createMainWindow(origin); return; }
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        });
        notification.show();
      }
    } catch {
      // Offline tick or a mid-restart server — the next poll tries again.
    }
  };

  const timer = setInterval(() => { void tick(); }, NOTIFICATION_POLL_MS);
  timer.unref();
}

// ── Menu ──────────────────────────────────────────────────────────────────────

function buildMenu(): void {
  const backgroundRemindersSubmenu: Electron.MenuItemConstructorOptions[] = app.isPackaged
    ? [
        {
          label: 'Enable Background Reminders…',
          click: async () => {
            try {
              await installLaunchAgent({
                executablePath: process.execPath,
                scriptPath: path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'dist', 'reminder-sweep.cjs'),
                sqlitePath: sqlitePathFor(app.getPath('userData')),
              });
              await dialog.showMessageBox({
                type: 'info',
                message: 'Background reminders are enabled.',
                detail: 'A macOS LaunchAgent will sweep for due reminders every 5 minutes, even while HitList is closed.',
              });
            } catch (error) {
              dialog.showErrorBox('Could not enable background reminders', String(error));
            }
          },
        },
        {
          label: 'Disable Background Reminders',
          click: async () => {
            try {
              await uninstallLaunchAgent();
              await dialog.showMessageBox({ type: 'info', message: 'Background reminders are disabled.' });
            } catch (error) {
              dialog.showErrorBox('Could not disable background reminders', String(error));
            }
          },
        },
        {
          label: launchAgentInstalled() ? 'Background Reminders: Installed' : 'Background Reminders: Not Installed',
          enabled: false,
        },
      ]
    : [{ label: 'Background Reminders (packaged app only)', enabled: false }];

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Reveal Data Folder',
          click: () => { void shell.openPath(app.getPath('userData')); },
        },
        { type: 'separator' },
        ...backgroundRemindersSubmenu,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
