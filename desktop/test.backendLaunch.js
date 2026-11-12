'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { jvmArgs, failureReason, privateTempDir } = require('./backendLaunch');

const present = (...files) => ({ existsSync: (target) => files.includes(target), mkdirSync: () => {} });
const RES = path.join('/opt', 'HitList', 'resources');
const LIB = path.join(RES, 'native', 'libsqlitejdbc.so');
const DATA = path.join('/home', 'a', '.config', 'HitList');

test('linux: the bundled SQLite library is loaded from beside the app, and nothing is left to /tmp', () => {
  const args = jvmArgs({ fs: present(LIB), platform: 'linux', resourcesPath: RES, userDataDir: DATA });
  assert.ok(args.includes(`-Dorg.sqlite.lib.path=${path.join(RES, 'native')}`));
  assert.ok(args.includes('-Dorg.sqlite.lib.name=libsqlitejdbc.so'));
  assert.ok(args.includes('--enable-native-access=ALL-UNNAMED'));
  assert.ok(args.includes(`-Dorg.sqlite.tmpdir=${path.join(DATA, 'tmp')}`));
  assert.ok(args.includes(`-Djava.io.tmpdir=${path.join(DATA, 'tmp')}`));
  assert.ok(!args.some((arg) => arg.startsWith('-Dorg.sqlite.tmpdir=/tmp') || arg === '-Djava.io.tmpdir=/tmp'));
});

test('linux: without the bundled library the driver still gets a temporary folder of ours, not /tmp', () => {
  const args = jvmArgs({ fs: present(), platform: 'linux', resourcesPath: RES, userDataDir: DATA });
  assert.ok(!args.some((arg) => arg.startsWith('-Dorg.sqlite.lib')));
  assert.ok(args.includes(`-Dorg.sqlite.tmpdir=${path.join(DATA, 'tmp')}`));
});

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: no library path is passed, only the temporary folder and the native-access flag`, () => {
    const args = jvmArgs({ fs: present(LIB), platform, resourcesPath: RES, userDataDir: DATA });
    assert.ok(!args.some((arg) => arg.startsWith('-Dorg.sqlite.lib')));
    assert.ok(args.includes('--enable-native-access=ALL-UNNAMED'));
  });
}

test('a data folder that cannot hold a temporary folder leaves the driver its defaults rather than failing', () => {
  const denied = { existsSync: () => false, mkdirSync: () => { throw Object.assign(new Error('no'), { code: 'EACCES' }); } };
  const args = jvmArgs({ fs: denied, platform: 'linux', resourcesPath: RES, userDataDir: DATA });
  assert.deepEqual(args, ['--enable-native-access=ALL-UNNAMED']);
});

test('the temporary folder is private to the person running the app', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hitlist-launch-'));
  try {
    const dir = privateTempDir({ fs, userDataDir: root });
    assert.equal(dir, path.join(root, 'tmp'));
    assert.equal(fs.statSync(dir).mode & 0o077, 0, 'no access for group or others');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a library that cannot be loaded is explained in words and points at the log', () => {
  const log = 'Caused by: java.lang.UnsatisfiedLinkError: /tmp/sqlite-3.53.4.0-x-libsqlitejdbc.so: failed to map segment from shared object';
  const reason = failureReason({ log, code: 1, logPath: '/home/a/.config/HitList/backend.log' });
  assert.match(reason, /could not load its local database library/);
  assert.match(reason, /does not allow running programs/);
  assert.match(reason, /\/home\/a\/\.config\/HitList\/backend\.log/);
});

test('any other early exit names the root cause line and the log', () => {
  const log = 'INFO starting\nERROR Application run failed\nCaused by: java.net.BindException: Address already in use\n';
  const reason = failureReason({ log, code: 1, logPath: '/x/backend.log' });
  assert.match(reason, /exit code 1/);
  assert.match(reason, /BindException: Address already in use/);
  assert.match(reason, /\/x\/backend\.log/);
});

test('an early exit with an empty log still says something useful', () => {
  assert.match(failureReason({ log: '', code: 3, logPath: '/x/backend.log' }), /exit code 3.*\/x\/backend\.log/);
});
