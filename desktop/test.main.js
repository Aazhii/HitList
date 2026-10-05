const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function launch({ failNavigation = false, backupGate, platform = 'darwin', packaged = false, missingJava = false, spawnError = false } = {}) {
  const app = new EventEmitter();
  app.isPackaged = packaged;
  app.getPath = (name) => name === 'appData' ? '/fake' : '/fake/HitList';
  app.setPath = () => {};
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.quit = () => { app.quitCalls++; };
  app.quitCalls = 0;
  app.getVersion = () => '1.0.0';

  const windows = [];
  let headerHandler;
  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return windows.filter((win) => !win.closed); }
    constructor() {
      super();
      this.closed = false;
      this.webContents = {
        session: { webRequest: { onBeforeSendHeaders: (_filter, handler) => { headerHandler = handler; } } },
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
  const spawn = (executable, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.executable = executable;
    child.args = args;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    children.push(child);
    if (spawnError) queueMicrotask(() => child.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' })));
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
    mkdirSync: () => {}, existsSync: (target) => !(missingJava && /[\\/]jre[\\/]bin[\\/]java/.test(target)),
    readFileSync: () => 'test-secret', writeFileSync: () => {},
  };
  let accounts = 0;
  let backupOptions;
  let alertOptions;
  const powerMonitor = new EventEmitter();
  let wakeChecks = 0;
  const uploads = [];
  const lifecycle = [];
  const backup = (options) => { backupOptions = options; return { startSchedule: () => {}, status: () => ({}), backupNow: async () => ({ result: 'ok' }),
    beforeSignOut: async () => { lifecycle.push('backup-start'); await backupGate; lifecycle.push('backup-end'); return { result: 'backed-up' }; },
    cancel: async () => { lifecycle.push('backup-cancel'); },
  }; };
  const mocks = {
    electron: { app, BrowserWindow, ipcMain, powerMonitor, dialog: { showErrorBox: (_title, message) => errors.push(message) }, shell: {} },
    './auth': { createAuth: () => ({ cachedAccount: () => ({ userId: String(++accounts), email: `account-${accounts}@test.invalid` }), signOut: async () => { lifecycle.push('clear-session'); },
      fetchAs: async (identity, url, options, isCurrent) => { uploads.push({ identity, url, options, current: isCurrent() }); return { status: 201, text: async () => '{}' }; },
    }), ownerFor: (id) => id },
    './backup': { createBackup: backup },
    './restore': { createRestore: () => ({ check: async () => ({}), restore: async () => { lifecycle.push('restore'); return {}; } }) },
    './cliqAlerts': { createCliqAlerts: (options) => { alertOptions = options; return { startSchedule: () => {}, status: () => ({}), setSettings: () => ({}), sendTest: async () => ({}),
      cancel: () => { lifecycle.push('alerts-cancel'); }, check: async () => { wakeChecks++; },
    }; } },
    './cliqConnection': { createCliqConnection: () => ({ stop: () => { lifecycle.push('stop'); }, beforeRestore: async () => { lifecycle.push('beforeRestore'); }, get: async () => ({}), start: async () => ({}), confirm: async () => ({}), enable: async () => ({}), fetchNow: async () => ({}), unlink: async () => ({}) }) },
    './updater': { createUpdater: () => ({ status: () => ({}), check: () => {}, download: () => {}, cancel: () => {}, install: () => {}, startSchedule: () => () => {} }) },
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
    __dirname, process: { ...process, platform, resourcesPath: '/fake/resources', env: {} },
    console: { log: () => {}, error: () => {} },
    Buffer, AbortSignal, setTimeout, clearTimeout, setInterval: () => {}, fetch: () => {},
  }, { filename: 'main.js' });
  return { app, windows, children, handlers, errors, lifecycle, uploads, powerMonitor, wakeChecks: () => wakeChecks,
    alertOptions: () => alertOptions, uploadBackup: (...args) => backupOptions.upload(...args), requestHeaders: (method) => {
    let result;
    headerHandler({ method, requestHeaders: {}, url: 'http://127.0.0.1:41000/api/notes' }, out => { result = out; });
    return result;
  } };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('alerts use account-pinned bounded transport, cancel on logout and clean up resume listeners', async () => {
  const rig = launch(); await settle();
  const options = rig.alertOptions();
  assert.equal(typeof options.localPost, 'function');
  assert.equal(options.getWorkspace(), null);
  const controller = new AbortController();
  await options.send('/notify/overdue', { email: 'test@invalid.example', tasks: [] }, {
    accountIdentity: '1', signal: controller.signal, isCurrent: () => true,
  });
  assert.equal(rig.uploads.at(-1).identity, '1');
  assert.equal(rig.uploads.at(-1).current, true);
  controller.abort(); assert.equal(rig.uploads.at(-1).options.signal.aborted, true);
  rig.powerMonitor.emit('resume'); await settle(); assert.equal(rig.wakeChecks(), 1);
  await assert.rejects(rig.handlers.get('cliq:get')(null, { accountId: 'other', workspaceId: null }), /Account changed/);
  await rig.handlers.get('account:signOut')();
  assert.ok(rig.lifecycle.includes('alerts-cancel'));
  await assert.rejects(options.send('/notify/overdue', {}, {
    accountIdentity: '1', signal: new AbortController().signal, isCurrent: () => false,
  }), /Account changed/);
  rig.windows[0].close(); assert.equal(rig.powerMonitor.listenerCount('resume'), 0);
});

test('backup upload forwards the trigger reason through the account-pinned cloud request', async () => {
  const { windows, uploads, uploadBackup } = launch();
  await settle();
  for (const reason of ['manual', 'signed-in', 'sign-out']) {
    const result = await uploadBackup(Buffer.from('snapshot'), 'content-hash', { accountIdentity: '1', signal: new AbortController().signal, reason });
    assert.equal(result.status, 201);
    assert.equal(uploads.at(-1).options.headers['x-backup-reason'], reason);
    assert.equal(uploads.at(-1).options.headers['x-content-hash'], 'content-hash');
    assert.equal(uploads.at(-1).identity, '1');
    assert.equal(uploads.at(-1).current, true);
  }
  windows[0].close();
});

test('Java spawn failure reports a controlled startup error instead of an unhandled event', async () => {
  const { errors, app, windows } = launch({ packaged: true, spawnError: true });
  await settle();
  assert.match(errors[0], /Java could not start \(EACCES\)/);
  assert.equal(app.quitCalls, 1);
  assert.equal(windows.length, 0);
});

for (const platform of ['darwin', 'win32', 'linux']) {
  test(`${platform}: packaged startup uses bundled Java and jar`, async () => {
    const { children, errors } = launch({ platform, packaged: true });
    await settle();
    assert.equal(children.length, 1);
    assert.equal(children[0].executable, path.join('/fake/resources', 'jre', 'bin', platform === 'win32' ? 'java.exe' : 'java'));
    assert.deepEqual(Array.from(children[0].args), ['-jar', path.join('/fake/resources', 'hitlist.jar')]);
    assert.deepEqual(errors, []);
  });

  test(`${platform}: missing bundled Java is reported without using system Java`, async () => {
    const { children, errors, app } = launch({ platform, packaged: true, missingJava: true });
    await settle();
    assert.equal(children.length, 0);
    assert.match(errors[0], /Bundled Java runtime is missing/);
    assert.equal(app.quitCalls, 1);
  });
}

test('logout waits for the outgoing backup before clearing cookies and blocks concurrent sign-in', async () => {
  let release;
  const backupGate = new Promise(resolve => { release = resolve; });
  const { handlers, lifecycle } = launch({ backupGate });
  await settle();
  const logout = handlers.get('account:signOut')();
  await settle();
  assert.equal(lifecycle.includes('clear-session'), false);
  assert.equal((await handlers.get('account:signIn')()).userId, '1');
  release();
  assert.equal((await logout).backup, 'backed-up');
  assert.deepEqual(lifecycle.slice(-4), ['backup-start', 'backup-end', 'backup-cancel', 'clear-session']);
  assert.equal(handlers.get('account:get')(), null);
});

test('outgoing renderer writes stay blocked after logout until the new identity is confirmed', async () => {
  const { handlers, requestHeaders } = launch();
  await settle();
  assert.equal(requestHeaders('POST').requestHeaders['X-Hitlist-Desktop-User'], '1');
  await handlers.get('account:signOut')();
  assert.equal(requestHeaders('POST').cancel, true);
  assert.throws(() => handlers.get('account:ready')(null, '1'), /does not match/);
  assert.equal(requestHeaders('POST').cancel, true);
  handlers.get('account:ready')(null, 'desktop-local-v1');
  assert.equal(requestHeaders('POST').cancel, undefined);
  assert.equal(requestHeaders('POST').requestHeaders['X-Hitlist-Desktop-User'], undefined);
});

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