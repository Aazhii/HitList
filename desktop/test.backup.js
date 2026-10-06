const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createBackup, contentHash, BACKUP_INTERVAL, ERROR_BACKOFF } = require('./backup');

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

test('a scheduled backup is due only when the last good one is older than three days', async () => {
  const { svc, advance } = rig();
  assert.equal(svc.due(), true);
  await svc.backupNow();
  assert.equal(svc.due(), false);
  advance(BACKUP_INTERVAL - 1000);
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

test('a delayed account A snapshot is never uploaded after switching to B', async () => {
  let user = '111111';
  let release;
  let captured;
  const { svc, calls } = rig({
    getAccount: () => ({ userId: user }),
    localGet: (_url, options) => { captured = options.accountIdentity; return new Promise(resolve => { release = resolve; }); },
  });
  const pending = svc.backupNow();
  user = '222222';
  release(Buffer.from(JSON.stringify(snap([{ TaskId: 'private-a' }]))));
  assert.equal((await pending).result, 'cancelled');
  assert.equal(captured, '111111');
  assert.equal(calls.uploads.length, 0);
  assert.equal(svc.status().lastSuccessAt, null);
});

test('cancelling a stalled snapshot settles the backup and prevents a late upload', async () => {
  let release;
  const { svc, calls } = rig({ localGet: () => new Promise(resolve => { release = resolve; }) });
  const pending = svc.backupNow();
  await svc.cancel();
  assert.equal((await pending).result, 'cancelled');
  release(Buffer.from(JSON.stringify(snap([{ TaskId: 'private-a' }]))));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.uploads.length, 0);
});

test('cancelling while pre-logout waits for an older backup does not start a new upload', async () => {
  const { svc, calls } = rig({ localGet: () => new Promise(() => {}) });
  const old = svc.backupNow();
  const logout = svc.beforeSignOut();
  await svc.cancel();
  assert.equal((await old).result, 'cancelled');
  assert.equal((await logout).result, 'cancelled');
  assert.equal(calls.uploads.length, 0);
});

test('pre-logout takes a fresh snapshot after a running backup completes', async () => {
  let release;
  let first = true;
  const hashes = [];
  const { svc, set } = rig({ upload: async (_bytes, hash) => {
    hashes.push(hash);
    if (first) { first = false; await new Promise(resolve => { release = resolve; }); }
    return { status: 201 };
  } });
  const pending = svc.backupNow();
  await new Promise(resolve => setImmediate(resolve));
  set(snap([{ TaskId: 'a', Title: 'last edit before logout' }]));
  const logout = svc.beforeSignOut();
  release();
  await pending;
  assert.equal((await logout).result, 'backed-up');
  assert.equal(hashes.length, 2);
  assert.notEqual(hashes[0], hashes[1]);
});

test('at the daily limit it stops asking until the server said it would allow another', async () => {
  const replies = [() => ({ status: 429, body: JSON.stringify({ retryAt: 1_000_000 + 5 * 60 * 60 * 1000 }) }), () => ({ status: 201 })];
  const { svc, calls, advance, set } = rig({ upload: async () => replies.shift()() });
  assert.deepEqual(await svc.backupNow(), { result: 'daily-limit', retryAt: 1_000_000 + 5 * 60 * 60 * 1000 });
  set(snap([{ TaskId: 'a', Title: 'changed again' }]));
  assert.equal((await svc.backupNow()).result, 'daily-limit');
  assert.equal(calls.local, 1);
  assert.equal(svc.due(), true);
  advance(5 * 60 * 60 * 1000 + 1000);
  assert.equal((await svc.backupNow()).result, 'backed-up');
});

test('manual limit does not block logout, login, scheduled or update backups and automatic success preserves it', async () => {
  const triggers = [];
  const retryAt = 1_000_000 + 24 * 60 * 60 * 1000;
  const { svc, set } = rig({ upload: async (_bytes, _hash, options) => {
    triggers.push(options.reason);
    return options.reason === 'manual' ? { status: 429, body: { retryAt } } : { status: 201 };
  } });
  assert.equal((await svc.backupNow()).result, 'daily-limit');
  assert.equal(svc.due(), true);
  for (const reason of ['sign-out', 'signed-in', 'scheduled', 'update']) {
    set(snap([{ TaskId: 'a', Title: reason }]));
    const result = reason === 'sign-out' ? await svc.beforeSignOut() : await svc.backupNow(reason);
    assert.equal(result.result, 'backed-up');
    assert.deepEqual(await svc.backupNow('manual'), { result: 'daily-limit', retryAt });
  }
  assert.deepEqual(triggers, ['manual', 'sign-out', 'signed-in', 'scheduled', 'update']);
});

test('legacy cached daily limit applies only to manual backups and survives an automatic success', async () => {
  const { svc, dir, set, calls } = rig();
  const retryAt = 1_000_000 + 24 * 60 * 60 * 1000;
  fs.writeFileSync(path.join(dir, 'backup-state.json'), JSON.stringify({ userId: '75733000000033001', blockedUntil: retryAt }));
  assert.equal((await svc.backupNow()).result, 'daily-limit');
  assert.equal((await svc.beforeSignOut()).result, 'backed-up');
  set(snap([{ TaskId: 'a', Title: 'new manual edit' }]));
  assert.deepEqual(await svc.backupNow(), { result: 'daily-limit', retryAt });
  assert.equal(calls.uploads.length, 1);
});

test('login racing a manual limit response runs under its own exempt trigger', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const reasons = [];
  const { svc } = rig({ upload: async (_bytes, _hash, options) => {
    reasons.push(options.reason);
    if (options.reason === 'manual') {
      await gate;
      return { status: 429, body: { retryAt: 2_000_000 } };
    }
    return { status: 201 };
  } });
  const manual = svc.backupNow();
  const login = svc.backupNow('signed-in');
  release();
  assert.equal((await manual).result, 'daily-limit');
  assert.equal((await login).result, 'backed-up');
  assert.deepEqual(reasons, ['manual', 'signed-in']);
});

test('cancelling a running backup also cancels the queued automatic trigger', async () => {
  const { svc, calls } = rig({ localGet: () => new Promise(() => {}) });
  const manual = svc.backupNow();
  const login = svc.backupNow('signed-in');
  await svc.cancel();
  assert.equal((await manual).result, 'cancelled');
  assert.equal((await login).result, 'cancelled');
  assert.equal(calls.uploads.length, 0);
});

test('after a server error the scheduled backup waits an hour before trying again', async () => {
  const replies = [() => ({ status: 500 }), () => ({ status: 201 })];
  const { svc, advance } = rig({ upload: async () => replies.shift()() });
  assert.equal((await svc.backupNow()).result, 'error');
  assert.equal(svc.due(), false);
  advance(ERROR_BACKOFF + 1000);
  assert.equal(svc.due(), true);
  assert.equal((await svc.backupNow()).result, 'backed-up');
});
