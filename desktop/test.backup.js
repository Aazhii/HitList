const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createBackup, contentHash, SIX_HOURS } = require('./backup');

const snap = (rows, at = 'T1') => ({ schema: 'hitlist.backup.v1', exportedAt: at, tables: { KaizenTasks: rows, KaizenLists: [] } });
const rig = (over = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-backup-'));
  let clock = 1_000_000;
  const calls = { uploads: [], local: 0 };
  let current = snap([{ TaskId: 'a', Title: 'one' }]);
  const deps = {
    stateDir: dir,
    getAccount: () => ({ userId: '75733000000033001' }),
    localGet: async () => { calls.local++; return Buffer.from(JSON.stringify(current)); },
    upload: async (bytes, hash) => { calls.uploads.push({ bytes, hash }); return { status: 201, body: {} }; },
    now: () => clock,
    ...over,
  };
  return { svc: createBackup(deps), calls, dir, advance: (ms) => { clock += ms; }, set: (s) => { current = s; } };
};

test('the hash ignores the export time and the order of rows, and notices a real change', () => {
  const a = snap([{ TaskId: 'a', Title: 'one' }, { TaskId: 'b', Title: 'two' }], 'T1');
  const b = snap([{ TaskId: 'b', Title: 'two' }, { TaskId: 'a', Title: 'one' }], 'T2');
  assert.equal(contentHash(a), contentHash(b));
  assert.notEqual(contentHash(a), contentHash(snap([{ TaskId: 'a', Title: 'one!' }, { TaskId: 'b', Title: 'two' }])));
});

test('backs up a changed workspace once, gzipped, and asks the cloud nothing when it is unchanged', async () => {
  const { svc, calls, set } = rig();
  assert.equal((await svc.backupNow()).result, 'backed-up');
  assert.equal(calls.uploads.length, 1);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(calls.uploads[0].bytes).toString()).tables.KaizenTasks, [{ TaskId: 'a', Title: 'one' }]);
  assert.equal((await svc.backupNow()).result, 'unchanged');
  set(snap([{ TaskId: 'a', Title: 'one' }], 'a later export time'));
  assert.equal((await svc.backupNow()).result, 'unchanged');
  assert.equal(calls.uploads.length, 1);
  set(snap([{ TaskId: 'a', Title: 'edited' }]));
  assert.equal((await svc.backupNow()).result, 'backed-up');
  assert.equal(calls.uploads.length, 2);
});

test('does nothing when signed out', async () => {
  const { svc, calls } = rig({ getAccount: () => null });
  assert.equal((await svc.backupNow()).result, 'signed-out');
  assert.equal(calls.local, 0);
  assert.equal(calls.uploads.length, 0);
  assert.equal(svc.due(), false);
});

test('offline is quiet and retried; an expired session is reported; a server error is not a success', async () => {
  const replies = [() => { throw new Error('ENOTFOUND'); }, () => ({ status: 401 }), () => ({ status: 500 }), () => ({ status: 201 })];
  const { svc } = rig({ upload: async () => replies.shift()() });
  assert.equal((await svc.backupNow()).result, 'offline');
  assert.equal(svc.status().lastSuccessAt, null);
  assert.equal((await svc.backupNow()).result, 'sign-in-needed');
  assert.equal((await svc.backupNow()).result, 'error');
  assert.equal(svc.status().lastSuccessAt, null);
  assert.equal((await svc.backupNow()).result, 'backed-up');
  assert.ok(svc.status().lastSuccessAt);
});

test('a scheduled backup is due only when the last good one is older than six hours', async () => {
  const { svc, advance } = rig();
  assert.equal(svc.due(), true);
  await svc.backupNow();
  assert.equal(svc.due(), false);
  advance(SIX_HOURS - 1000);
  assert.equal(svc.due(), false);
  advance(2000);
  assert.equal(svc.due(), true);
});

test('another account does not inherit the last account\'s backup state', async () => {
  let user = '111111';
  const { svc, calls } = rig({ getAccount: () => ({ userId: user }) });
  await svc.backupNow();
  assert.equal(svc.status().lastSuccessAt !== null, true);
  user = '222222';
  assert.equal(svc.status().lastSuccessAt, null);
  assert.equal(svc.due(), true);
  assert.equal((await svc.backupNow()).result, 'backed-up');
  assert.equal(calls.uploads.length, 2);
});

test('two requests at once share one backup', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { svc, calls } = rig({ upload: async (bytes, hash) => { await gate; calls2.push(hash); return { status: 201 }; } });
  const calls2 = [];
  const a = svc.backupNow(); const b = svc.backupNow();
  release();
  assert.deepEqual(await a, await b);
  assert.equal(calls2.length, 1);
  void calls;
});

test('a local server error is reported and nothing is uploaded', async () => {
  const { svc, calls } = rig({ localGet: async () => { throw new Error('refused'); } });
  assert.equal((await svc.backupNow()).result, 'local-error');
  assert.equal(calls.uploads.length, 0);
});
