'use strict';

/**
 * Keeps this computer's copies of shared workspaces in step with the other members, without polling.
 *
 *   • Your changes: the local server queues every change to a shared list/task (its "outbox"). When the app has just made
 *     a change (kick), a few seconds later they go up as one batch: ONE cloud write per batch, which is what keeps the free
 *     Data Store allowance last. A failed send is retried later with a growing delay, and only while something is waiting.
 *   • Other members' changes: Ably rings a doorbell on the workspace channel; the engine then pulls everything after its
 *     cursor and hands it to the local server, strictly in order. The doorbell carries no data. After any reconnect, and at
 *     start, it catches up the same way, so nothing is missed while the app was closed or offline.
 *   • Nothing runs on a timer when idle.
 *
 * Pure of Electron, like backup.js: the local server, the cloud, the push client, timers and notifications are passed in.
 *   localGet(path) -> Buffer        localPost(path, body) -> { status, json }
 *   cloud(method, path, body, { signal }) -> { status, json }
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const FLUSH_DELAY = 3_000;
const MIN_BETWEEN_FLUSHES = 5_000;
const RETRY_STEPS = [30_000, 60_000, 120_000, 300_000];
const MAX_OPS_BYTES = 8_500;
const MAX_OPS = 200;
const MAX_TEXT = 4_900;
const MAX_PAGES = 50;

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

/** One op as one or more ops that each fit a cloud batch; a field too long to send is left out and counted. */
function fitOp(op) {
  if (op.deleted || !op.fields) return { ops: [op], skipped: 0 };
  const fields = {};
  let skipped = 0;
  for (const [key, value] of Object.entries(op.fields)) {
    if (typeof value === 'string' && value.length > MAX_TEXT) { skipped += 1; continue; }
    fields[key] = value;
  }
  const out = [];
  let group = {};
  for (const [key, value] of Object.entries(fields)) {
    const next = { ...group, [key]: value };
    if (Object.keys(group).length && bytes({ table: op.table, id: op.id, fields: next }) > MAX_OPS_BYTES) {
      out.push({ table: op.table, id: op.id, fields: group });
      group = { [key]: value };
    } else {
      group = next;
    }
  }
  if (Object.keys(group).length) out.push({ table: op.table, id: op.id, fields: group });
  return { ops: out, skipped };
}

function createWorkspaceSync({
  stateDir, getAccount, localGet, localPost, cloud, createPush, onApplied = () => {}, onAssigned = () => {}, onChange = () => {},
  fetchTask = async () => null, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, uuid = randomUUID,
}) {
  const deviceFile = path.join(stateDir, 'workspace-device.json');
  const batchFile = path.join(stateDir, 'workspace-batches.json');
  let pendingBatches = {};
  let batchStateError = false;
  try {
    const saved = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) pendingBatches = saved;
    else batchStateError = true;
  } catch (error) { if (error.code !== 'ENOENT') batchStateError = true; }
  const saveBatch = (key, ids) => {
    const next = { ...pendingBatches };
    if (ids) next[key] = ids; else delete next[key];
    fs.writeFileSync(`${batchFile}.tmp`, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(`${batchFile}.tmp`, batchFile);
    pendingBatches = next;
  };
  let deviceId;
  try { deviceId = JSON.parse(fs.readFileSync(deviceFile, 'utf8')).deviceId; } catch { /* first run */ }
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) {
    deviceId = uuid();
    try { fs.writeFileSync(deviceFile, JSON.stringify({ deviceId }), { mode: 0o600 }); } catch { /* kept in memory */ }
  }

  let epoch = 0;                 // changes on stop(), so work started for a signed-out account is dropped
  let running = false;
  let abort = null;
  let stopPush = null;
  let pushIds = '';
  let timers = { flush: null, retry: null };
  let retryStep = 0;
  let lastFlushAt = 0;
  let refreshing = null;
  const chains = new Map();      // per workspace: one sync at a time
  const state = { lastError: null, skippedFields: 0, rejectedOps: 0 };

  const me = () => getAccount()?.userId || null;
  const status = () => ({ running, pushOn: !!stopPush, ...state });
  const fail = (code) => { state.lastError = code; onChange(status()); };

  const local = async (urlPath) => JSON.parse((await localGet(urlPath)).toString('utf8'));
  const serial = (id, work) => {
    const run = (chains.get(id) || Promise.resolve()).catch(() => {}).then(work);
    chains.set(id, run);
    return run;
  };

  // ── which workspaces ────────────────────────────────────────────────────────────────────────────────────────────────

  const localWorkspaces = () => local('/api/sync/workspaces');

  async function register(ws, state_ = 'active') {
    return localPost('/api/sync/workspaces', {
      workspaceId: ws.workspaceId, name: ws.name, role: ws.role, members: ws.members, state: state_,
    });
  }

  /** Reads the account's workspaces from the cloud and mirrors them locally; anything it no longer belongs to is kept read-only. */
  function refresh() {
    if (refreshing?.epoch === epoch) return refreshing.promise;
    const current = { epoch, promise: null };
    current.promise = refreshNow().finally(() => { if (refreshing === current) refreshing = null; });
    refreshing = current;
    return current.promise;
  }

  async function refreshNow() {
    const version = epoch;
    if (!me()) return;
    const res = await cloud('GET', '/ws', undefined, { signal: abort?.signal });
    if (res.status !== 200 || !Array.isArray(res.json?.workspaces)) { fail(res.status === 503 ? 'workspaces-unavailable' : 'cloud-error'); scheduleRetry(); return; }
    if (version !== epoch) return;
    const mine = res.json.workspaces;
    if (['offline', 'cloud-error', 'workspaces-unavailable'].includes(state.lastError)) state.lastError = null;
    const known = await localWorkspaces();
    if (version !== epoch) return;
    for (const ws of mine) await register(ws, 'active');
    if (version !== epoch) return;
    const still = new Set(mine.map((w) => w.workspaceId));
    for (const ws of known) {
      if (!still.has(ws.workspaceId) && ws.state === 'active') await register(ws, 'removed');
    }
    onChange(status());
    await ensurePush(mine.map((w) => w.workspaceId));
    if (version !== epoch) return;
    await Promise.all(mine.map((w) => syncWorkspace(w.workspaceId)));
    if (mine.length && !stopPush) {
      if (!state.lastError) fail('push-unavailable');
      scheduleRetry();
    }
    if (!state.lastError && timers.retry) { clearTimer(timers.retry); timers.retry = null; }
  }

  // ── sending ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  async function flush(id) {
    const version = epoch;
    const batchKey = `${me()}:${id}`;
    for (let round = 0; round < 20; round += 1) {
      const outbox = await local(`/api/sync/outbox?workspaceId=${encodeURIComponent(id)}&limit=${MAX_OPS}`);
      if (version !== epoch) return false;
      if (batchStateError) throw new Error('Workspace retry state unavailable');
      if (!outbox.ops.length) { if (pendingBatches[batchKey]) saveBatch(batchKey, null); return true; }
      const savedIds = pendingBatches[batchKey];
      if (savedIds && (!Array.isArray(savedIds) || savedIds.some((opId) => typeof opId !== 'string'))) throw new Error('Invalid workspace retry state');
      const entries = savedIds ? outbox.ops.filter((entry) => savedIds.includes(entry.opId)) : outbox.ops;
      if (savedIds && !entries.length) { saveBatch(batchKey, null); continue; }
      if (savedIds && entries.length !== savedIds.length) throw new Error('Incomplete workspace retry batch');
      // Batches are cut from the front; a batch is a run of queued ops that fits one cloud write.
      const batch = [];
      const opIds = [];
      let size = 2;
      for (const entry of entries) {
        const fitted = fitOp(entry.op);
        state.skippedFields += fitted.skipped;
        const cost = bytes(fitted.ops);
        if (batch.length && (size + cost > MAX_OPS_BYTES || batch.length + fitted.ops.length > MAX_OPS)) break;
        batch.push(...fitted.ops);
        opIds.push(entry.opId);
        size += cost;
      }
      if (!batch.length) { await localPost('/api/sync/outbox/ack', { workspaceId: id, opIds }); continue; }
      // The batch id is derived from the queued ops, so a retry after a lost reply is recognised and stored once.
      const batchId = createHash('sha256').update(opIds.join(',')).digest('hex').slice(0, 40);
      saveBatch(batchKey, opIds);
      const res = await cloud('POST', `/ws/${id}/changes`, { deviceId, batchId, ops: batch }, { signal: abort?.signal });
      if (version !== epoch) return false;
      if (res.status === 200) {
        if (res.json.signalDelivered === false) throw Object.assign(new Error('Notification unavailable'), { code: 'notification-delayed' });
        await localPost('/api/sync/outbox/ack', { workspaceId: id, opIds });
        saveBatch(batchKey, null);
        if (state.lastError !== 'push-unavailable') state.lastError = null;
        continue;
      }
      if (res.status === 403) { await markRemoved(id); return false; }
      if (res.status === 400 || res.status === 413) {
        // The cloud will never accept this batch. Dropping it keeps one bad change from blocking every later one; the local
        // copy still has it, it just is not shared.
        state.rejectedOps += opIds.length;
        await localPost('/api/sync/outbox/ack', { workspaceId: id, opIds });
        saveBatch(batchKey, null);
        fail('change-rejected');
        continue;
      }
      throw new Error(`send ${res.status}`);
    }
    return true;
  }

  // ── receiving ───────────────────────────────────────────────────────────────────────────────────────────────────────

  async function markRemoved(id) {
    const known = (await localWorkspaces()).find((w) => w.workspaceId === id);
    if (known && known.state === 'active') await register(known, 'removed');
    onChange(status());
  }

  async function pull(id) {
    const version = epoch;
    const self = me();
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const info = (await localWorkspaces()).find((w) => w.workspaceId === id);
      if (!info) return;
      const res = await cloud('GET', `/ws/${id}/changes?after=${info.cursor}&limit=200`, undefined, { signal: abort?.signal });
      if (version !== epoch) return;
      if (res.status === 403) { await markRemoved(id); return; }
      if (res.status !== 200) throw new Error(`pull ${res.status}`);
      const { changes, hasMore } = res.json;
      if (!changes.length) return;
      const prepared = changes.map((c) => ({ seq: c.seq, ops: c.ops, own: c.deviceId === deviceId }));
      const applied = await localPost('/api/sync/apply', { workspaceId: id, changes: prepared });
      if (applied.status !== 200) throw new Error(`apply ${applied.status}`);
      if (version !== epoch) return;
      if (applied.json.applied > 0) onApplied(id);
      await announceAssignments(id, changes, self);
      if (applied.json.gap || !hasMore) return;
    }
  }

  /** Tells the person when someone else has just given them a task. */
  async function announceAssignments(id, changes, self) {
    if (!self) return;
    const seen = new Set();
    for (const change of changes) {
      if (change.deviceId === deviceId || change.authorUserId === self) continue;
      for (const op of change.ops) {
        if (op.table === 'tasks' && op.fields && op.fields.AssigneeUserId === self && !seen.has(op.id)) {
          seen.add(op.id);
          let title = typeof op.fields.Title === 'string' ? op.fields.Title : null;
          if (!title) { try { title = (await fetchTask(id, op.id))?.title || null; } catch { title = null; } }
          onAssigned({ workspaceId: id, taskId: op.id, title: title || 'A task', by: change.authorUserId });
        }
      }
    }
  }

  function syncWorkspace(id) {
    return serial(id, async () => {
      const version = epoch;
      try {
        let sendError;
        try { await flush(id); } catch (error) { sendError = error; }
        if (version !== epoch) return;
        await pull(id);
        if (sendError) throw sendError;
        if (stopPush && (!state.lastError || state.lastError === 'offline')) retryStep = 0;
        state.lastError = state.lastError === 'offline' ? null : state.lastError;
        onChange(status());
      } catch (error) {
        if (version !== epoch) return;
        fail(error?.code === 'notification-delayed' ? 'notification-delayed' : 'offline');
        scheduleRetry();
      }
    });
  }

  const syncAll = async () => {
    if (!me()) return;
    const list = await localWorkspaces();
    await Promise.all(list.filter((w) => w.state === 'active').map((w) => syncWorkspace(w.workspaceId)));
  };

  // ── timers and push ─────────────────────────────────────────────────────────────────────────────────────────────────

  function scheduleRetry() {
    if (timers.retry || !running) return;
    const delay = RETRY_STEPS[Math.min(retryStep, RETRY_STEPS.length - 1)];
    retryStep += 1;
    timers.retry = setTimer(() => {
      timers.retry = null;
      void refresh().catch(() => { fail('offline'); scheduleRetry(); });
    }, delay);
    timers.retry.unref?.();
  }

  /** The app has just changed something: send it in a few seconds, as one batch, and not more than once every few seconds. */
  function kick() {
    if (!running || !me() || timers.flush) return;
    const wait = Math.max(FLUSH_DELAY, MIN_BETWEEN_FLUSHES - (now() - lastFlushAt));
    timers.flush = setTimer(() => {
      timers.flush = null;
      lastFlushAt = now();
      void syncAll().catch(() => {});
    }, wait);
    timers.flush.unref?.();
  }

  async function ensurePush(ids) {
    const version = epoch;
    const key = [...ids].sort().join(',');
    if (key === pushIds && (stopPush || !ids.length)) return;
    if (stopPush) { stopPush(); stopPush = null; }
    pushIds = key;
    if (!ids.length || !abort) return;
    const pending = new Set();
    const ring = (id) => {
      if (pending.has(id)) return;
      pending.add(id);
      setTimer(() => { pending.delete(id); void syncWorkspace(id).catch(() => {}); }, 400).unref?.();
    };
    try {
      const push = createPush({
        requestToken: async ({ signal }) => {
          const res = await cloud('POST', '/ws/token', {}, { signal });
          if (res.status !== 200) throw new Error('token');
          return res.json;
        },
      });
      const stop = await push.subscribe({
        signal: abort.signal,
        onSignal: (id) => { if (version === epoch) ring(id); },
        onReconnect: () => { if (version === epoch) void refresh().catch(() => { fail('offline'); scheduleRetry(); }); },
        onUnavailable: () => {
          if (version !== epoch || !running) return;
          if (stopPush) stopPush();
          stopPush = null;
          pushIds = '';
          fail('push-unavailable');
          scheduleRetry();
        },
      });
      if (version !== epoch) { stop?.(); return; }
      stopPush = stop;
      if (!stop) throw new Error('No workspace subscription');
      if (state.lastError === 'push-unavailable') state.lastError = null;
    } catch {
      if (version !== epoch) return;
      stopPush = null;
      pushIds = '';
      fail('push-unavailable');
      scheduleRetry();
    }
    onChange(status());
  }

  // ── actions from the app ────────────────────────────────────────────────────────────────────────────────────────────

  const ok = (res) => res.status === 200;

  async function create({ name, listIds = [] } = {}) {
    const res = await cloud('POST', '/ws', { name }, { signal: abort?.signal });
    if (!ok(res)) return { ok: false, reason: res.json?.error || 'cloud-error' };
    await register(res.json, 'active');
    if (listIds.length) await localPost('/api/sync/seed', { workspaceId: res.json.workspaceId, listIds });
    await refresh();
    lastFlushAt = 0;
    kick();
    return { ok: true, workspace: res.json };
  }

  async function invite(workspaceId, email) {
    const res = await cloud('POST', `/ws/${workspaceId}/invite`, { email }, { signal: abort?.signal });
    return ok(res) ? { ok: true, ...res.json } : { ok: false, reason: res.json?.error || 'cloud-error' };
  }

  async function accept(token) {
    const res = await cloud('POST', '/ws/invite/accept', { token }, { signal: abort?.signal });
    if (!ok(res)) return { ok: false, reason: res.json?.error || 'cloud-error' };
    await register(res.json, 'active');
    await refresh();
    return { ok: true, workspace: res.json };
  }

  async function removeMember(workspaceId, userId) {
    const res = await cloud('POST', `/ws/${workspaceId}/members/remove`, { userId }, { signal: abort?.signal });
    if (ok(res)) await refresh();
    return ok(res) ? { ok: true } : { ok: false, reason: res.json?.error || 'cloud-error' };
  }

  async function leave(workspaceId) {
    const res = await cloud('POST', `/ws/${workspaceId}/leave`, {}, { signal: abort?.signal });
    if (ok(res)) await refresh();
    return ok(res) ? { ok: true } : { ok: false, reason: res.json?.error || 'cloud-error' };
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────────────

  async function start() {
    if (running || !me()) return;
    running = true;
    epoch += 1;
    abort = new AbortController();
    retryStep = 0;
    try { await refresh(); } catch { fail('offline'); scheduleRetry(); }
    onChange(status());
  }

  function stop() {
    epoch += 1;
    running = false;
    if (abort) abort.abort();
    abort = null;
    if (stopPush) { stopPush(); stopPush = null; }
    pushIds = '';
    for (const key of Object.keys(timers)) { if (timers[key]) clearTimer(timers[key]); timers[key] = null; }
    onChange(status());
  }

  return { start, stop, refresh, kick, create, invite, accept, removeMember, leave, status, syncAll, deviceId: () => deviceId };
}

module.exports = { createWorkspaceSync, fitOp };
