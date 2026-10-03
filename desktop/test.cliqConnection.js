'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCliqConnection } = require('./cliqConnection');

const ACCOUNT = { userId: '123456', email: 'person@example.test' };
const NOW = 1_800_000_000_000;

function rig(t) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitlist-cliq-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  let account = ACCOUNT;
  let remote = null;
  let pending = [];
  let ready = true;
  let localStatus = 200;
  let cloudFailure = null;
  let uuidCount = 0;
  const calls = [];
  const subscriptions = [];
  const applied = [];
  const options = {
    stateDir, getAccount: () => account, now: () => NOW, uuid: () => `device-${++uuidCount}`,
    localGet: async (route, config) => {
      calls.push({ route, config });
      if (!ready) throw new Error('No workspace');
      return Buffer.from('{}');
    },
    localPost: async (route, body, config) => {
      calls.push({ route, body, config });
      return { status: localStatus, json: { status: 'applied', task: { taskId: 'one' } } };
    },
    cloudPost: async (route, body, config) => {
      calls.push({ route, body, config });
      if (cloudFailure) throw cloudFailure;
      if (route === '/cliq/link') return remote;
      if (route === '/cliq/link/start') return { code: 'public-code', nonce: 'private-nonce', expiresAt: NOW + 60_000 };
      if (route === '/cliq/link/confirm') {
        remote = { accountId: account.userId, deviceId: body.deviceId, generation: 9,
          linkId: 'link-one', email: account.email, timeZone: 'America/New_York' };
        return remote;
      }
      if (route === '/cliq/link/unlink') { remote = null; return { unlinked: true }; }
      if (route === '/cliq/pending') return pending;
      if (route === '/cliq/ack') { pending = pending.filter((item) => item.id !== body.commandId); return { acknowledged: true }; }
      throw new Error(`Unexpected route ${route}`);
    },
    createPush: () => ({ subscribe: async (_identity, handlers) => {
      subscriptions.push(handlers);
      return () => subscriptions.push('closed');
    } }),
    onApplied: () => applied.push('refresh'),
  };
  const controller = createCliqConnection(options);
  return { controller, calls, applied, subscriptions, stateDir, options,
    setAccount: (value) => { account = value; }, setReady: (value) => { ready = value; },
    setRemote: (value) => { remote = value; }, setPending: (items) => { pending = items; },
    setLocalStatus: (value) => { localStatus = value; }, setCloudFailure: (value) => { cloudFailure = value; },
    link: () => remote, restart: () => createCliqConnection(options) };
}

async function paired(setup) {
  await setup.controller.start('America/New_York');
  await setup.controller.confirm();
  return setup.link();
}

test('pairing keeps nonce private and intake off until explicitly enabled', async (t) => {
  const setup = rig(t);
  assert.equal(setup.controller.status().linked, false);
  const started = await setup.controller.start('America/New_York');
  assert.equal(started.code, 'public-code');
  assert.equal(started.expiresAt, NOW + 60_000);
  assert.equal(JSON.stringify(started).includes('private-nonce'), false);
  assert.deepEqual(setup.calls.find((call) => call.route === '/cliq/link/start').body,
    { deviceId: 'device-1', timeZone: 'America/New_York' });
  const confirmed = await setup.controller.confirm();
  assert.equal(confirmed.linked, true);
  assert.equal(confirmed.enabled, false);
  assert.equal(confirmed.code, undefined);
  assert.deepEqual(setup.calls.find((call) => call.route === '/cliq/link/confirm').body,
    { nonce: 'private-nonce', deviceId: 'device-1' });
  assert.equal(setup.calls.some((call) => call.route === '/cliq/pending'), false);
  setup.controller.stop();
});

test('opt-in fetch executes exact envelope under pinned owner and ACKs only valid outcome', async (t) => {
  const setup = rig(t);
  const link = await paired(setup);
  const command = { id: 'command-one', accountId: link.accountId, deviceId: link.deviceId,
    generation: link.generation, schemaVersion: 1, type: 'create', payload: { title: 'Task' }, expiresAt: NOW + 1000 };
  setup.setPending([command]);
  const enabled = await setup.controller.enable(true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.connected, true);
  const execution = setup.calls.find((call) => call.route === '/api/cliq/commands');
  assert.deepEqual(execution.body, command);
  assert.equal(execution.config.accountIdentity, ACCOUNT.userId);
  assert.deepEqual(execution.config.headers, { 'X-Timezone': link.timeZone });
  assert.deepEqual(setup.calls.find((call) => call.route === '/cliq/ack').body,
    { deviceId: link.deviceId, generation: link.generation, commandId: command.id,
      result: { status: 'applied', task: { taskId: 'one' } } });
  assert.deepEqual(setup.applied, ['refresh']);
  await setup.controller.enable(false);
  assert.equal(setup.controller.status().connected, false);
  setup.controller.stop();
});

test('restart restores same device and enabled link only after workspace session succeeds', async (t) => {
  const setup = rig(t);
  await paired(setup);
  await setup.controller.enable(true);
  setup.controller.stop();
  const saved = JSON.parse(fs.readFileSync(path.join(setup.stateDir, 'cliq-connection.json')));
  assert.equal(fs.statSync(path.join(setup.stateDir, 'cliq-connection.json')).mode & 0o777, 0o600);
  assert.equal(saved[ACCOUNT.userId].deviceId, 'device-1');
  const restarted = setup.restart();
  setup.setReady(false);
  assert.equal((await restarted.get()).connected, false);
  assert.equal(setup.calls.filter((call) => call.route === '/cliq/pending').length, 1);
  setup.setReady(true);
  assert.equal((await restarted.get()).connected, true);
  restarted.stop();
});

test('foreign remote link cannot replace locally persisted link or start intake', async (t) => {
  const setup = rig(t);
  await paired(setup);
  await setup.controller.enable(false);
  setup.setRemote({ ...setup.link(), deviceId: 'someone-else' });
  const status = await setup.controller.get();
  assert.equal(status.linked, false);
  assert.equal(status.error, 'unavailable');
  setup.controller.stop();
});

test('signout during pending fetch stops local mutation and ACK', async (t) => {
  const setup = rig(t);
  await paired(setup);
  await setup.controller.enable(true);
  setup.controller.stop();
  let completeFetch;
  const originalPost = setup.options.cloudPost;
  setup.options.cloudPost = async (route, body, config) => {
    if (route === '/cliq/pending') return new Promise((resolve) => { completeFetch = resolve; });
    return originalPost(route, body, config);
  };
  const restarted = setup.restart();
  const running = restarted.get();
  while (!completeFetch) await new Promise((resolve) => setImmediate(resolve));
  setup.setAccount(null);
  restarted.stop();
  completeFetch([{ id: 'old', accountId: ACCOUNT.userId, deviceId: 'device-1', generation: 9,
    schemaVersion: 1, type: 'create', payload: {}, expiresAt: NOW + 1000 }]);
  assert.equal((await running).available, false);
  assert.equal(setup.calls.some((call) => call.route === '/api/cliq/commands' || call.route === '/cliq/ack'), false);
});

test('restore attempt rotates device and invalidates old commands before restore runs', async (t) => {
  const setup = rig(t);
  const old = await paired(setup);
  await setup.controller.beforeRestore();
  assert.equal(setup.controller.status().linked, false);
  const saved = JSON.parse(fs.readFileSync(path.join(setup.stateDir, 'cliq-connection.json')))[ACCOUNT.userId];
  assert.notEqual(saved.deviceId, old.deviceId);
  assert.equal(saved.needsUnlink, false);
  assert.equal((await setup.controller.get()).linked, false);
  assert.equal(setup.calls.some((call) => call.route === '/cliq/link/unlink'), true);
  setup.controller.stop();
});

test('4xx local rejection is bounded failure; 5xx is retryable without ACK', async (t) => {
  const setup = rig(t);
  const link = await paired(setup);
  setup.setPending([{ id: 'rejected', accountId: link.accountId, deviceId: link.deviceId,
    generation: link.generation, schemaVersion: 1, type: 'edit', payload: {}, expiresAt: NOW + 1000 }]);
  setup.setLocalStatus(422);
  await setup.controller.enable(true);
  assert.deepEqual(setup.calls.find((call) => call.route === '/cliq/ack').body.result,
    { status: 'failed' });
  setup.setLocalStatus(503);
  setup.setPending([{ id: 'retry', accountId: link.accountId, deviceId: link.deviceId,
    generation: link.generation, schemaVersion: 1, type: 'edit', payload: {}, expiresAt: NOW + 1000 }]);
  assert.equal((await setup.controller.fetchNow()).lastResult, 'retry-needed');
  assert.equal(setup.calls.some((call) => call.route === '/cliq/ack' && call.body.commandId === 'retry'), false);
  setup.controller.stop();
});

test('failed cloud and workspace requests return safe status without credentials or command bodies', async (t) => {
  const setup = rig(t);
  setup.setReady(false);
  assert.equal((await setup.controller.start('America/New_York')).error, 'workspace-unavailable');
  setup.setReady(true);
  setup.setCloudFailure(Object.assign(new Error('secret token from provider'), { status: 401 }));
  const status = await setup.controller.start('America/New_York');
  assert.equal(status.error, 'auth-required');
  assert.equal(JSON.stringify(status).includes('secret token'), false);
  setup.controller.stop();
});

test('account switch during cloud link request drops its response without storing a link', async (t) => {
  const setup = rig(t);
  let resolveLink;
  const originalPost = setup.options.cloudPost;
  setup.options.cloudPost = (route, body, config) => route === '/cliq/link'
    ? new Promise((resolve) => { resolveLink = resolve; }) : originalPost(route, body, config);
  const restarted = setup.restart();
  const running = restarted.start('America/New_York');
  while (!resolveLink) await new Promise((resolve) => setImmediate(resolve));
  setup.setAccount({ userId: '999999', email: 'other@example.test' });
  restarted.stop();
  resolveLink(null);
  assert.equal((await running).code, undefined);
  assert.equal(setup.calls.some((call) => call.route === '/cliq/link/start'), false);
  assert.equal(restarted.status().linked, false);
});

test('forbidden account policy is not mistaken for an expired login', async (t) => {
  const setup = rig(t);
  setup.setCloudFailure(Object.assign(new Error('private server details'), { status: 403, code: 'invalid_account' }));
  assert.equal((await setup.controller.get()).error, 'account-not-allowed');
  setup.setCloudFailure(Object.assign(new Error('private server details'), { status: 403 }));
  assert.equal((await setup.controller.get()).error, 'access-denied');
  setup.controller.stop();
});