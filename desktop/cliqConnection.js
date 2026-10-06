'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCliqInbox } = require('./cliqInbox');
const { createCliqPush } = require('./cliqPush');

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_ZONE = /^[A-Za-z0-9_+\/-]{1,100}$/;

function createCliqConnection({ stateDir, getAccount, localGet, localPost, cloudPost, onApplied = () => {},
  createInbox = createCliqInbox, createPush = createCliqPush, now = Date.now, uuid = randomUUID }) {
  const file = path.join(stateDir, 'cliq-connection.json');
  let records = {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) records = saved;
  } catch { /* No saved link yet. */ }
  let pending = null;
  let activeAccount = null;
  let ready = false;
  let epoch = 0;
  let error = null;
  let lastResult = 'stopped';
  let worker;

  const accountId = () => getAccount()?.userId || null;
  const record = () => records[accountId()] || null;
  const current = (id, version) => id && id === accountId() && version === epoch && ready;
  const linkForWorker = () => {
    const entry = record();
    return ready && !entry?.needsUnlink && entry?.enabled && entry?.link?.accountId === accountId()
      && entry.link.deviceId === entry.deviceId && validLink(entry.link, accountId(), entry.deviceId)
      ? { ...entry.link, enabled: true } : null;
  };
  const save = () => {
    const temp = `${file}.${uuid()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(records), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
    } catch (cause) {
      try { fs.rmSync(temp, { force: true }); } catch { /* preserve original error */ }
      throw cause;
    }
  };
  const stop = () => {
    epoch++;
    pending = null;
    ready = false;
    worker.stop();
    lastResult = 'stopped';
  };
  const sync = () => {
    const id = accountId();
    if (id !== activeAccount) {
      stop();
      activeAccount = id;
      error = null;
    }
    return id;
  };
  const entryFor = (id) => {
    if (!records[id] || !SAFE_ID.test(records[id].deviceId)) {
      records[id] = { deviceId: uuid(), enabled: false, link: null, needsUnlink: false };
      save();
    }
    return records[id];
  };
  const status = () => {
    const id = sync();
    const entry = id && records[id];
    const linked = !!entry?.link && entry.link.accountId === id && entry.link.deviceId === entry.deviceId;
    return { available: !!id, linked, email: linked ? entry.link.email : null,
      enabled: !!(linked && entry.enabled && !entry.needsUnlink),
      connected: !!(linked && worker.status().active), lastResult,
      ...(pending && pending.accountId === id ? { code: pending.code, expiresAt: pending.expiresAt } : {}),
      ...(error ? { error } : {}) };
  };
  const fail = (cause) => {
    error = cause?.status === 401 ? 'auth-required'
      : cause?.status === 403 && cause?.code === 'invalid_account' ? 'account-not-allowed'
      : cause?.status === 403 ? 'access-denied'
      : cause?.status === 409 ? 'link-conflict' : 'unavailable';
    return status();
  };
  const post = async (route, body, id, version, signal) => {
    if (!current(id, version)) throw new Error('inactive');
    const result = await cloudPost(route, body, { signal });
    if (!current(id, version)) throw new Error('inactive');
    return result;
  };
  const validLink = (value, id, deviceId) => value && value.accountId === id && value.deviceId === deviceId
    && Number.isSafeInteger(value.generation) && value.generation > 0
    && typeof value.linkId === 'string' && SAFE_ID.test(value.linkId)
    && typeof value.email === 'string' && value.email.length <= 320
    && typeof value.timeZone === 'string' && SAFE_ZONE.test(value.timeZone);

  const push = createPush({ requestToken: (identity, { signal }) =>
    post('/cliq/token', { deviceId: identity.deviceId, generation: identity.generation }, identity.accountId, epoch, signal) });
  worker = createInbox({
    getLink: linkForWorker,
    subscribe: push.subscribe,
    fetchPending: (identity, { limit, signal }) =>
      post('/cliq/pending', { deviceId: identity.deviceId, generation: identity.generation, limit }, identity.accountId, epoch, signal),
    execute: async (command, identity) => {
      const version = epoch;
      if (!current(identity.accountId, version)) throw new Error('inactive');
      const reply = await localPost('/api/cliq/commands', command, {
        accountIdentity: identity.accountId, headers: { 'X-Timezone': record().link.timeZone }, signal: identity.signal,
      });
      if (!current(identity.accountId, version)) throw new Error('inactive');
      if (reply.status === 200 && reply.json && ['applied', 'failed', 'expired'].includes(reply.json.status)) return reply.json;
      if (reply.status >= 400 && reply.status < 500) return { status: 'failed' };
      throw new Error('Local command unavailable');
    },
    acknowledge: (commandId, result, identity) =>
      post('/cliq/ack', { deviceId: identity.deviceId, generation: identity.generation, commandId, result }, identity.accountId, epoch, identity.signal),
    onApplied: ({ accountId: id }) => { if (id === accountId() && ready) onApplied(); },
    now,
  });

  async function prepare() {
    const id = sync();
    if (!id) return null;
    const version = epoch;
    try {
      await localGet('/api/session', { accountIdentity: id });
      if (id !== accountId() || version !== epoch) return null;
      ready = true;
      return { id, version };
    } catch {
      ready = false;
      error = 'workspace-unavailable';
      return null;
    }
  }

  async function resolveLink(context) {
    const entry = entryFor(context.id);
    if (entry.needsUnlink) {
      await post('/cliq/link/unlink', {}, context.id, context.version);
      if (!current(context.id, context.version)) return null;
      entry.needsUnlink = false;
      save();
    }
    const remote = await post('/cliq/link', { deviceId: entry.deviceId }, context.id, context.version);
    if (remote !== null && !validLink(remote, context.id, entry.deviceId)) {
      entry.link = null;
      entry.enabled = false;
      worker.stop();
      save();
      throw new Error('Link identity mismatch');
    }
    if (!current(context.id, context.version)) return null;
    if (remote && (!entry.link || entry.link.linkId === remote.linkId)) entry.link = remote;
    else {
      entry.link = null;
      entry.enabled = false;
      worker.stop();
    }
    save();
    return entry;
  }

  async function get() {
    try {
      const context = await prepare();
      if (context) {
        const entry = await resolveLink(context);
        if (entry?.enabled && entry.link) await startWorker(context);
      }
      if (context && current(context.id, context.version)) error = null;
    } catch (cause) { fail(cause); }
    return status();
  }

  async function startWorker(context) {
    if (!current(context.id, context.version)) return;
    const outcome = await worker.start();
    if (current(context.id, context.version)) lastResult = outcome.result;
  }

  async function start(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    try {
      if (!SAFE_ZONE.test(timeZone)) throw new Error('Invalid timezone');
      const context = await prepare();
      if (!context) return status();
      const entry = await resolveLink(context);
      if (!entry || !current(context.id, context.version)) return status();
      const result = await post('/cliq/link/start', { deviceId: entry.deviceId, timeZone }, context.id, context.version);
      if (!result || typeof result.code !== 'string' || typeof result.nonce !== 'string'
        || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now()) throw new Error('Invalid link response');
      pending = { accountId: context.id, deviceId: entry.deviceId, nonce: result.nonce, code: result.code, expiresAt: result.expiresAt };
      error = null;
    } catch (cause) { fail(cause); }
    return status();
  }

  async function confirm() {
    try {
      const context = await prepare();
      const pairing = pending;
      if (!context || !pairing || pairing.accountId !== context.id || pairing.expiresAt <= now()) {
        pending = null;
        throw new Error('Pairing expired');
      }
      const result = await post('/cliq/link/confirm', { nonce: pairing.nonce, deviceId: pairing.deviceId }, context.id, context.version);
      if (!validLink(result, context.id, pairing.deviceId)) throw new Error('Link identity mismatch');
      const entry = entryFor(context.id);
      entry.link = result;
      entry.enabled = false;
      save();
      pending = null;
      error = null;
    } catch (cause) { fail(cause); }
    return status();
  }

  async function enable(value) {
    try {
      const context = await prepare();
      if (!context || typeof value !== 'boolean') throw new Error('Unavailable');
      const entry = await resolveLink(context);
      if (!entry?.link || !current(context.id, context.version)) throw new Error('Not linked');
      entry.enabled = value;
      save();
      if (value) await startWorker(context);
      else { worker.stop(); lastResult = 'stopped'; }
      error = null;
    } catch (cause) { fail(cause); }
    return status();
  }

  async function fetchNow() {
    try {
      const context = await prepare();
      if (!context || !linkForWorker()) throw new Error('Unavailable');
      if (!worker.status().active) await startWorker(context);
      else {
        const outcome = await worker.fetchNow();
        if (current(context.id, context.version)) lastResult = outcome.result;
      }
      error = null;
    } catch (cause) { fail(cause); }
    return status();
  }

  async function unlink() {
    const id = sync();
    if (!id) return status();
    stop();
    activeAccount = id;
    const entry = entryFor(id);
    entry.enabled = false;
    entry.link = null;
    entry.needsUnlink = true;
    save();
    try {
      const context = await prepare();
      if (context) await resolveLink(context);
      error = null;
    } catch (cause) { fail(cause); }
    return status();
  }

  async function beforeRestore() {
    const id = sync();
    stop();
    activeAccount = id;
    if (id) {
      const entry = entryFor(id);
      entry.deviceId = uuid();
      entry.link = null;
      entry.enabled = false;
      entry.needsUnlink = true;
      save();
      try {
        await cloudPost('/cliq/link/unlink', {});
        if (id === accountId() && entry === records[id]) {
          entry.needsUnlink = false;
          save();
        }
      } catch { /* Retry before a future link operation. */ }
    }
  }

  return { status, get, start, confirm, enable, fetchNow, unlink, beforeRestore, stop };
}

module.exports = { createCliqConnection };