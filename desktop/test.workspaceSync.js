'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceSync, fitOp } = require('./workspaceSync');

const WS = 'w'.repeat(43);
const ME = '100001';
const OTHER = '200002';

function fakeTimers() {
  const queue = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; queue.push(t); return t; },
    clearTimer: (t) => { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); },
    queue,
    /** Runs the timers that are waiting now (and any they set that are due at once), but not retries scheduled for later. */
    async runAll({ includeRetries = false } = {}) {
      for (let guard = 0; guard < 50 && queue.length; guard += 1) {
        const i = queue.findIndex((t) => includeRetries || t.ms < 30_000);
        if (i < 0) return;
        const [t] = queue.splice(i, 1);
        await t.fn();
        await new Promise((r) => setImmediate(r));
      }
    },
  };
}

/** The cloud's workspace routes, in memory, shared by every device in a test. */
function fakeCloud() {
  const cloud = { changes: [], posts: [], down: false, forbidden: false, reject: false, members: [{ userId: ME, name: 'Me', email: 'me@x.com', role: 'owner' }] };
  cloud.call = async (method, url, body) => {
    if (cloud.down) throw new Error('offline');
    if (method === 'GET' && url === '/ws') return { status: 200, json: { workspaces: [{ workspaceId: WS, name: 'Team', role: 'owner', members: cloud.members }] } };
    if (method === 'POST' && url === '/ws/token') return { status: 200, json: { token: 'jwt', channels: { [WS]: `hitlist:ws:${'a'.repeat(64)}` } } };
    let m;
    if ((m = /^\/ws\/(.{43})\/changes$/.exec(url)) && method === 'POST') {
      if (cloud.forbidden) return { status: 403, json: { error: 'not_a_member' } };
      if (cloud.reject) return { status: 400, json: { error: 'invalid_ops' } };
      cloud.posts.push(body);
      const seen = cloud.changes.find((c) => c.batchId === body.batchId);
      if (seen) return { status: 200, json: { seq: seen.seq, duplicate: true } };
      const seq = cloud.changes.length + 1;
      cloud.changes.push({ seq, batchId: body.batchId, deviceId: body.deviceId, authorUserId: body.author || ME, ops: body.ops });
      return { status: 200, json: { seq, duplicate: false } };
    }
    if ((m = /^\/ws\/(.{43})\/changes\?after=(\d+)&limit=(\d+)$/.exec(url)) && method === 'GET') {
      if (cloud.forbidden) return { status: 403, json: { error: 'not_a_member' } };
      const rows = cloud.changes.filter((c) => c.seq > Number(m[2]));
      return { status: 200, json: { changes: rows.slice(0, Number(m[3])), hasMore: rows.length > Number(m[3]) } };
    }
    return { status: 404, json: {} };
  };
  return cloud;
}

/** The local server's /api/sync endpoints, in memory. */
function fakeLocal() {
  const local = { workspaces: [], outbox: [], applied: [], acks: [], seq: 0 };
  local.get = async (p) => {
    if (p === '/api/sync/workspaces') return Buffer.from(JSON.stringify(local.workspaces));
    if (p.startsWith('/api/sync/outbox')) return Buffer.from(JSON.stringify({ workspaceId: WS, ops: local.outbox.slice(0, 200) }));
    throw new Error(`unexpected GET ${p}`);
  };
  local.post = async (p, body) => {
    if (p === '/api/sync/workspaces') {
      const i = local.workspaces.findIndex((w) => w.workspaceId === body.workspaceId);
      const row = { ...(local.workspaces[i] || { cursor: 0 }), workspaceId: body.workspaceId, name: body.name, role: body.role, members: body.members, state: body.state };
      if (i >= 0) local.workspaces[i] = row; else local.workspaces.push(row);
      return { status: 200, json: row };
    }
    if (p === '/api/sync/outbox/ack') { local.acks.push(body.opIds); local.outbox = local.outbox.filter((e) => !body.opIds.includes(e.opId)); return { status: 200, json: { removed: body.opIds.length } }; }
    if (p === '/api/sync/apply') {
      const w = local.workspaces.find((x) => x.workspaceId === body.workspaceId);
      let applied = 0;
      for (const c of body.changes) {
        if (c.seq <= w.cursor) continue;
        if (c.seq !== w.cursor + 1) return { status: 200, json: { cursor: w.cursor, applied, gap: true } };
        if (!c.own) local.applied.push(c);
        w.cursor = c.seq; applied += 1;
      }
      return { status: 200, json: { cursor: w.cursor, applied, gap: false } };
    }
    if (p === '/api/sync/seed') return { status: 200, json: { lists: 1, tasks: 1 } };
    throw new Error(`unexpected POST ${p}`);
  };
  local.queue = (n, fields = { Title: 'x' }) => { for (let i = 0; i < n; i += 1) local.outbox.push({ opId: `op-${local.seq++}`, op: { table: 'tasks', id: `t${i}`, fields } }); };
  return local;
}

function fakePush() {
  const push = { starts: 0, stops: 0 };
  push.createPush = () => ({
    subscribe: async ({ signal, onSignal, onReconnect }) => {
      push.starts += 1; push.ring = onSignal; push.reconnect = onReconnect;
      return () => { push.stops += 1; };
    },
  });
  return push;
}

function rig(overrides = {}) {
  const cloud = overrides.cloud || fakeCloud();
  const local = fakeLocal();
  const push = fakePush();
  const timers = fakeTimers();
  const events = { applied: [], assigned: [], changes: [] };
  let clock = 1_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsync-'));
  const engine = createWorkspaceSync({
    stateDir: dir, getAccount: () => ({ userId: ME }), localGet: (...a) => local.get(...a), localPost: (...a) => local.post(...a),
    cloud: (...a) => cloud.call(...a), createPush: push.createPush,
    onApplied: (id) => events.applied.push(id), onAssigned: (x) => events.assigned.push(x), onChange: (s) => events.changes.push(s),
    fetchTask: async () => ({ title: 'Fetched title' }),
    now: () => clock, setTimer: timers.setTimer, clearTimer: timers.clearTimer, ...overrides,
  });
  return { engine, cloud, local, push, timers, events, advance: (ms) => { clock += ms; }, dir };
}

test('start mirrors the cloud\'s workspaces locally, listens for pushes, and catches up from the cursor', async () => {
  const t = rig();
  t.cloud.changes.push({ seq: 1, deviceId: 'other', authorUserId: OTHER, ops: [{ table: 'lists', id: 'l1', fields: { Name: 'L' } }] });
  await t.engine.start();
  assert.deepEqual(t.local.workspaces.map((w) => [w.workspaceId, w.name, w.state, w.cursor]), [[WS, 'Team', 'active', 1]]);
  assert.equal(t.push.starts, 1);
  assert.equal(t.local.applied.length, 1);
  assert.deepEqual(t.events.applied, [WS]);
});

test('a workspace the account no longer belongs to is kept, read-only', async () => {
  const t = rig();
  t.local.workspaces.push({ workspaceId: 'z'.repeat(43), name: 'Old', role: 'member', members: [], state: 'active', cursor: 4 });
  await t.engine.start();
  assert.equal(t.local.workspaces.find((w) => w.name === 'Old').state, 'removed');
  assert.equal(t.local.workspaces.find((w) => w.name === 'Old').cursor, 4);
});

test('local changes go up as ONE batch a few seconds after the app changed something', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(30);
  t.engine.kick(); t.engine.kick(); t.engine.kick();
  assert.equal(t.timers.queue.filter((x) => x.ms >= 3000).length, 1, 'kicks are coalesced into one timer');
  assert.equal(t.cloud.posts.length, 0, 'nothing is sent immediately');
  await t.timers.runAll();
  assert.equal(t.cloud.posts.length, 1);
  assert.equal(t.cloud.posts[0].ops.length, 30);
  assert.equal(t.local.outbox.length, 0);
});

test('sends are spaced out, and a batch that is too big for one write is cut into as few as possible', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(1); t.engine.kick(); await t.timers.runAll();
  t.advance(1000);
  t.local.queue(1); t.engine.kick();
  assert.ok(t.timers.queue[0].ms >= 4000, 'the next send waits out the minimum gap');
  await t.timers.runAll();
  t.local.queue(40, { Note: 'x'.repeat(2000) });
  t.engine.kick(); await t.timers.runAll();
  assert.ok(t.cloud.posts.length >= 3 && t.cloud.posts.length <= 12);
  assert.equal(t.local.outbox.length, 0);
  for (const post of t.cloud.posts) assert.ok(Buffer.byteLength(JSON.stringify(post.ops)) <= 9500);
});

test('the doorbell makes it pull, and its own changes only move the cursor', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(1); t.engine.kick(); await t.timers.runAll();
  t.cloud.changes.push({ seq: 2, deviceId: 'other', authorUserId: OTHER, ops: [{ table: 'tasks', id: 'tx', fields: { Title: 'From B' } }] });
  t.push.ring(WS, 2);
  await t.timers.runAll();
  assert.equal(t.local.workspaces[0].cursor, 2);
  assert.deepEqual(t.local.applied.map((c) => c.seq), [2], 'seq 1 was this device\'s own and was not applied again');
});

test('an offline send keeps the change queued and retries later with a growing delay, only while work is waiting', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(2);
  t.cloud.down = true;
  t.engine.kick(); await t.timers.runAll();
  assert.equal(t.local.outbox.length, 2);
  assert.equal(t.engine.status().lastError, 'offline');
  const first = t.timers.queue[0];
  assert.equal(first.ms, 30_000);
  await t.timers.queue.shift().fn(); await new Promise((r) => setImmediate(r));
  assert.equal(t.timers.queue[0].ms, 60_000, 'the delay grows');
  t.cloud.down = false;
  await t.timers.runAll({ includeRetries: true });
  assert.equal(t.local.outbox.length, 0);
  assert.equal(t.cloud.changes.length, 1);
  assert.equal(t.timers.queue.length, 0, 'nothing is scheduled once everything is sent');
});

test('retrying the same queued changes is recognised by the cloud as the same batch', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(2);
  const realPost = t.local.post;
  let lose = true;
  t.local.post = async (p, b) => { if (p === '/api/sync/outbox/ack' && lose) { lose = false; throw new Error('lost'); } return realPost(p, b); };
  t.engine.kick(); await t.timers.runAll();
  assert.equal(t.local.outbox.length, 2, 'the ack was lost, so the ops are still queued');
  await t.engine.syncAll();
  assert.equal(t.cloud.changes.length, 1, 'the cloud stored it once');
  assert.equal(t.local.outbox.length, 0);
});

test('being removed from a workspace keeps the local copy read-only', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(1);
  t.cloud.forbidden = true;
  t.engine.kick(); await t.timers.runAll();
  assert.equal(t.local.workspaces[0].state, 'removed');
});

test('a batch the cloud will never accept is dropped so it cannot block later changes', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(1);
  t.cloud.reject = true;
  t.engine.kick(); await t.timers.runAll();
  assert.equal(t.local.outbox.length, 0);
  assert.equal(t.engine.status().rejectedOps, 1);
  assert.equal(t.engine.status().lastError, 'change-rejected');
});

test('being given a task by someone else is announced, with its title', async () => {
  const t = rig();
  await t.engine.start();
  t.cloud.changes.push({ seq: 1, deviceId: 'other', authorUserId: OTHER, ops: [{ table: 'tasks', id: 'tk', fields: { AssigneeUserId: ME, Title: 'Review the plan' } }] });
  t.push.ring(WS, 1); await t.timers.runAll();
  assert.deepEqual(t.events.assigned, [{ workspaceId: WS, taskId: 'tk', title: 'Review the plan', by: OTHER }]);
  t.cloud.changes.push({ seq: 2, deviceId: 'other', authorUserId: OTHER, ops: [{ table: 'tasks', id: 'tk2', fields: { AssigneeUserId: ME } }] });
  t.push.ring(WS, 2); await t.timers.runAll();
  assert.equal(t.events.assigned[1].title, 'Fetched title');
  t.cloud.changes.push({ seq: 3, deviceId: 'other', authorUserId: ME, ops: [{ table: 'tasks', id: 'mine', fields: { AssigneeUserId: ME } }] });
  t.push.ring(WS, 3); await t.timers.runAll();
  assert.equal(t.events.assigned.length, 2, 'assigning yourself is not announced');
});

test('a reconnect catches up on everything missed', async () => {
  const t = rig();
  await t.engine.start();
  t.cloud.changes.push({ seq: 1, deviceId: 'other', authorUserId: OTHER, ops: [{ table: 'lists', id: 'l', fields: { Name: 'x' } }] });
  t.push.reconnect(); await new Promise((r) => setImmediate(r)); await t.timers.runAll();
  assert.equal(t.local.workspaces[0].cursor, 1);
});

test('stop silences everything: no timers, no listening, nothing sent afterwards', async () => {
  const t = rig();
  await t.engine.start();
  t.local.queue(1); t.engine.kick();
  t.engine.stop();
  assert.equal(t.timers.queue.length, 0);
  assert.equal(t.push.stops, 1);
  t.engine.kick();
  assert.equal(t.timers.queue.length, 0);
  assert.equal(t.cloud.posts.length, 0);
});

test('no account, no work', async () => {
  const t = rig({ getAccount: () => null });
  await t.engine.start();
  assert.equal(t.push.starts, 0);
  assert.equal(t.local.workspaces.length, 0);
});

test('a workspace this account just joined is pulled from the start', async () => {
  const t = rig();
  t.cloud.changes.push({ seq: 1, deviceId: 'other', authorUserId: OTHER, ops: [{ table: 'lists', id: 'l', fields: { Name: 'x' } }] });
  const realCall = t.cloud.call;
  t.cloud.call = async (m, u, b) => (u === '/ws/invite/accept' ? { status: 200, json: { workspaceId: WS, name: 'Team', role: 'member', members: [] } } : realCall(m, u, b));
  await t.engine.start();
  const out = await t.engine.accept('t'.repeat(43));
  assert.equal(out.ok, true);
  assert.equal(t.local.workspaces[0].cursor, 1);
});

test('creating a workspace from lists copies them in and sends them up', async () => {
  const t = rig();
  const realCall = t.cloud.call;
  t.cloud.call = async (m, u, b) => (u === '/ws' && m === 'POST' ? { status: 200, json: { workspaceId: WS, name: b.name, role: 'owner', members: t.cloud.members } } : realCall(m, u, b));
  await t.engine.start();
  const out = await t.engine.create({ name: 'Team', listIds: ['l1'] });
  assert.equal(out.ok, true);
  t.local.queue(3);
  await t.timers.runAll();
  assert.equal(t.cloud.posts.length >= 1, true);
});

test('long text is left out of the batch instead of being cut, and big edits are split', () => {
  const long = fitOp({ table: 'tasks', id: 't', fields: { Title: 'ok', Note: 'x'.repeat(6000) } });
  assert.equal(long.skipped, 1);
  assert.deepEqual(long.ops, [{ table: 'tasks', id: 't', fields: { Title: 'ok' } }]);
  const many = fitOp({ table: 'tasks', id: 't', fields: { A: 'a'.repeat(4000), B: 'b'.repeat(4000), C: 'c'.repeat(4000) } });
  assert.ok(many.ops.length >= 2);
  assert.deepEqual(many.ops.flatMap((o) => Object.keys(o.fields)), ['A', 'B', 'C']);
  assert.deepEqual(fitOp({ table: 'tasks', id: 't', deleted: true }).ops, [{ table: 'tasks', id: 't', deleted: true }]);
});
