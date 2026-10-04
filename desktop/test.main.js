const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function launch({ failNavigation = false } = {}) {
  const app = new EventEmitter();
  app.isPackaged = false;
  app.getPath = (name) => name === 'appData' ? '/fake' : '/fake/HitList';
  app.setPath = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.quit = () => { app.quitCalls++; };
  app.quitCalls = 0;
  app.getVersion = () => '1.0.0';

  const windows = [];
  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return windows.filter((win) => !win.closed); }
    constructor() {
      super();
      this.closed = false;
      this.webContents = {
        session: { webRequest: { onBeforeSendHeaders: () => {} } },
        send: () => {}, reload: () => {},
      };
      windows.push(this);
    }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; this.emit('closed'); app.emit('window-all-closed'); }
    loadURL(url) {
      this.url = url;
      return failNavigation ? Promise.reject(new Error('navigation failed')) : Promise.resolve();
    }
  }

  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`duplicate IPC handler: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler: (channel) => handlers.delete(channel),
  };
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    children.push(child);
    return child;
  };
  const createServer = () => {
    const server = new EventEmitter();
    server.unref = () => {};
    server.listen = (_port, _host, callback) => callback();
    server.address = () => ({ port: 41000 + children.length });
    server.close = (callback) => callback();
    return server;
  };
  const http = {
    get(_options, callback) {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.resume = () => {};
      queueMicrotask(() => callback(response));
      return new EventEmitter();
    },
  };
  const mockFs = {
    mkdirSync: () => {}, existsSync: () => true,
    readFileSync: () => 'test-secret', writeFileSync: () => {},
  };
  let accounts = 0;
  const lifecycle = [];
  const backup = () => ({ startSchedule: () => {}, status: () => ({}), backupNow: async () => ({ result: 'ok' }) });
  const mocks = {
    electron: { app, BrowserWindow, ipcMain, dialog: { showErrorBox: (_title, message) => errors.push(message) }, shell: {} },
    './auth': { createAuth: () => ({ cachedAccount: () => ({ userId: String(++accounts), email: `account-${accounts}@test.invalid` }) }), ownerFor: (id) => id },
    './backup': { createBackup: backup },
    './restore': { createRestore: () => ({ check: async () => ({}), restore: async () => { lifecycle.push('restore'); return {}; } }) },
    './cliqAlerts': { createCliqAlerts: () => ({ startSchedule: () => {}, status: () => ({}), setSettings: () => ({}), sendTest: async () => ({}) }) },
    './cliqConnection': { createCliqConnection: () => ({ stop: () => { lifecycle.push('stop'); }, beforeRestore: async () => { lifecycle.push('beforeRestore'); }, get: async () => ({}), start: async () => ({}), confirm: async () => ({}), enable: async () => ({}), fetchNow: async () => ({}), unlink: async () => ({}) }) },
    './updater': { createUpdater: () => ({ status: () => ({}), check: () => {}, download: () => {}, cancel: () => {}, install: () => {} }) },
    './installer': { cleanupAfterUpdate: () => {}, canSwap: () => false, swapPlan: () => ({ ok: false, reason: 'dev-run' }) },
    './dataDir': { dataDirIn: () => '/fake/HitList', migrateLegacyData: () => null, LEGACY_FOLDER: 'old' },
    './catalyst-config': { BACKUP_FUNCTION_URL: 'https://example.invalid' },
    'node:child_process': { spawn },
    'node:net': { createServer },
    'node:fs': mockFs,
    'node:http': http,
  };
  const errors = [];
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  vm.runInNewContext(source, {
    require: (name) => mocks[name] || require(name),
    __dirname, process: { ...process, platform: 'darwin', env: {} },
    console: { log: () => {}, error: () => {} },
    Buffer, setTimeout, setInterval: () => {}, fetch: () => {},
  }, { filename: 'main.js' });
  return { app, windows, children, handlers, errors, lifecycle };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('ready, close, and two activations reuse one live backend and rebind window IPC', async () => {
  const { app, windows, children, handlers, errors } = launch();
  await settle();
  assert.equal(windows[0].url, 'http://127.0.0.1:41000');
  assert.equal(handlers.get('account:get')().email, 'account-1@test.invalid');

  windows[0].close();
  app.emit('activate');
  app.emit('activate');
  await settle();
  assert.equal(windows.length, 2, 'concurrent activation opens one window');
  assert.equal(handlers.get('account:get')().email, 'account-2@test.invalid');
  windows[1].close();
  app.emit('activate');
  await settle();

  assert.equal(children.length, 1, 'only one Java sidecar was spawned');
  assert.deepEqual(windows.map((win) => win.url), Array(3).fill('http://127.0.0.1:41000'));
  assert.equal(handlers.get('account:get')().email, 'account-3@test.invalid');
  assert.deepEqual(errors, []);
  assert.equal(app.quitCalls, 0);
});

test('failed navigation reports the startup error instead of silently leaving a blank window', async () => {
  const { app, errors } = launch({ failNavigation: true });
  await settle();
  assert.match(errors[0], /navigation failed/);
  assert.equal(app.quitCalls, 1);
});

test('restore invalidates the connection first and reopens without duplicate connection IPC', async () => {
  const { app, windows, handlers, lifecycle } = launch();
  await settle();
  for (const channel of ['get', 'start', 'confirm', 'enable', 'fetch', 'unlink']) {
    assert.equal(typeof handlers.get(`cliq:connection:${channel}`), 'function');
  }
  await handlers.get('restore:run')();
  assert.deepEqual(lifecycle.slice(-2), ['beforeRestore', 'restore']);
  windows[0].close();
  assert.equal(lifecycle.at(-1), 'stop');
  app.emit('activate');
  await settle();
  assert.equal(windows.length, 2);
  assert.equal(typeof handlers.get('cliq:connection:get'), 'function');
});