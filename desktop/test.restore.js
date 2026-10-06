const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createRestore, isEmptyWorkspace } = require('./restore');
const { contentHash } = require('./backup');

const snap = (tasks = [], extra = {}) => ({ schema: 'hitlist.backup.v1', exportedAt: 'T', tables: { KaizenTasks: tasks, KaizenNotes: [], KaizenDatabases: [], KaizenLists: [{ ListId: 'default' }], ...extra } });
const rig = (over = {}) => {
  const calls = { list: 0, latest: 0, posted: [] };
  let local = snap();
  let cloud = [];
  let cloudBytes = null;
  const deps = {
    getAccount: () => ({ userId: '75733000000033001' }),
    localGet: async () => Buffer.from(JSON.stringify(local)),
    localPost: async (_p, body) => { calls.posted.push(body); return { status: 200, json: { imported: { KaizenTasks: 2 }, skipped: { KaizenTasks: 0 } } }; },
    cloudList: async () => { calls.list++; return cloud; },
    cloudLatest: async () => { calls.latest++; return cloudBytes; },
    lastBackupAt: () => null,
    ...over,
  };
  return { svc: createRestore(deps), calls, setLocal: (s) => { local = s; }, setCloud: (list, bytes) => { cloud = list; cloudBytes = bytes; } };
};
const T = [{ TaskId: 'a', Title: 'one' }];

test('a backup downloaded for A is never imported into B after account switching', async () => {
  let user = '111111';
  let release;
  const { svc, calls } = rig({ getAccount: () => ({ userId: user }), cloudLatest: () => new Promise(resolve => { release = resolve; }) });
  const pending = svc.restore();
  user = '222222';
  release(zlib.gzipSync(Buffer.from(JSON.stringify(snap(T)))));
  assert.equal((await pending).result, 'signed-out');
  assert.equal(calls.posted.length, 0);
});

test('the restore import explicitly carries the starting account identity', async () => {
  let identity;
  const { svc, setCloud } = rig({ localPost: async (_url, _body, options) => {
    identity = options.accountIdentity;
    return { status: 200, json: {} };
  } });
  setCloud([], zlib.gzipSync(Buffer.from(JSON.stringify(snap(T)))));
  assert.equal((await svc.restore()).result, 'restored');
  assert.equal(identity, '75733000000033001');
});

test('default lists alone do not make a workspace non-empty', () => {
  assert.equal(isEmptyWorkspace(snap()), true);
  assert.equal(isEmptyWorkspace(snap(T)), false);
  assert.equal(isEmptyWorkspace(snap([], { KaizenNotes: [{ NoteId: 'n' }] })), false);
  assert.equal(isEmptyWorkspace(null), true);
});

test('signed out: nothing to offer, no calls', async () => {
  const { svc, calls } = rig({ getAccount: () => null });
  assert.deepEqual(await svc.check(), { state: 'signed-out' });
  assert.equal(calls.list, 0);
});

test('a normal launch with data in the app makes no cloud call', async () => {
  const { svc, calls, setLocal } = rig();
  setLocal(snap(T));
  assert.deepEqual(await svc.check(), { state: 'skipped' });
  assert.equal(calls.list, 0);
});

test('an empty install with a backup is offered a restore; with no backup, nothing', async () => {
  const { svc, setCloud } = rig();
  assert.deepEqual(await svc.check(), { state: 'none' });
  setCloud([{ at: 5000, hash: 'f'.repeat(64), size: 10 }, { at: 1000, hash: 'e'.repeat(64), size: 10 }]);
  assert.deepEqual(await svc.check(), { state: 'restore-available', at: 5000, backups: 2 });
});

test('at sign-in, a backup made elsewhere is offered; your own latest one is not; an identical one is in sync', async () => {
  const { svc, setLocal, setCloud } = rig();
  setLocal(snap(T));
  setCloud([{ at: 9000, hash: 'f'.repeat(64), size: 10 }]);
  assert.deepEqual(await svc.check({ justSignedIn: true }), { state: 'newer-elsewhere', at: 9000, backups: 1 });

  const mine = rig({ lastBackupAt: () => 9500 });
  mine.setLocal(snap(T));
  mine.setCloud([{ at: 9000, hash: 'f'.repeat(64), size: 10 }]);
  assert.deepEqual(await mine.svc.check({ justSignedIn: true }), { state: 'local-is-newer' });

  const same = rig();
  same.setLocal(snap(T));
  same.setCloud([{ at: 9000, hash: contentHash(snap(T)), size: 10 }]);
  assert.deepEqual(await same.svc.check({ justSignedIn: true }), { state: 'in-sync' });
});

test('being offline is reported, not thrown', async () => {
  const { svc } = rig({ cloudList: async () => { throw new Error('ENOTFOUND'); } });
  assert.deepEqual(await svc.check(), { state: 'offline' });
});

test('restore downloads the newest backup and hands it to the add-only local import', async () => {
  const { svc, calls, setCloud } = rig();
  const backup = snap(T);
  setCloud([{ at: 1, hash: 'a'.repeat(64), size: 1 }], zlib.gzipSync(Buffer.from(JSON.stringify(backup))));
  const out = await svc.restore();
  assert.equal(out.result, 'restored');
  assert.deepEqual(out.imported, { KaizenTasks: 2 });
  assert.deepEqual(calls.posted[0].tables.KaizenTasks, T);
});

test('restore refuses a damaged download and reports a local failure', async () => {
  const bad = rig();
  bad.setCloud([{ at: 1, hash: 'a'.repeat(64), size: 1 }], Buffer.from('this is not gzip'));
  assert.equal((await bad.svc.restore()).result, 'damaged');
  assert.equal(bad.calls.posted.length, 0);

  const failing = rig({ localPost: async () => ({ status: 400, json: {} }) });
  failing.setCloud([{ at: 1, hash: 'a'.repeat(64), size: 1 }], zlib.gzipSync(Buffer.from(JSON.stringify(snap(T)))));
  assert.equal((await failing.svc.restore()).result, 'local-error');

  const none = rig();
  none.setCloud([], null);
  assert.equal((await none.svc.restore()).result, 'none');
  assert.equal((await rig({ getAccount: () => null }).svc.restore()).result, 'signed-out');
  assert.equal((await rig({ cloudLatest: async () => { throw new Error('x'); } }).svc.restore()).result, 'offline');
});
