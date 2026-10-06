'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCliqPush } = require('./cliqPush');

const IDENTITY = { accountId: '75733000000033001', deviceId: 'device-a', generation: 1 };
const AUTH = { ...IDENTITY, channel: 'hitlist:inbox:opaque_account_channel', token: 'temporary-subscribe-token' };

function rig(overrides = {}) {
  const controller = new AbortController();
  const calls = [];
  let options;
  let messageHandler;
  let attachHandler;
  let tokenCalls = 0;
  const channel = {
    on: (_event, handler) => { attachHandler = handler; },
    off: () => calls.push('off'),
    subscribe: async (event, handler) => { calls.push(event); messageHandler = handler; },
    unsubscribe: () => calls.push('unsubscribe'),
  };
  const push = createCliqPush({
    requestToken: async () => { tokenCalls += 1; return { ...AUTH }; },
    createRealtime: (value) => {
      options = value;
      calls.push('create');
      return {
        channels: { get: (name) => { calls.push(name); return channel; } },
        connect: () => calls.push('connect'),
        close: () => calls.push('close'),
      };
    },
    ...overrides,
  });
  return {
    push, controller, calls,
    getOptions: () => options,
    getTokenCalls: () => tokenCalls,
    message: () => messageHandler({ data: { ignored: 'Never execute push payloads' } }),
    reattach: () => attachHandler(),
    handlers: { signal: controller.signal, onSignal: () => calls.push('signal'), onReconnect: () => calls.push('reconnect') },
  };
}

test('connects only to the authorized opaque channel and forwards signals without task data', async () => {
  const setup = rig();
  const stop = await setup.push.subscribe(IDENTITY, setup.handlers);
  assert.deepEqual(setup.calls, ['create', AUTH.channel, 'connect', 'inbox-changed']);
  assert.equal(setup.getOptions().key, undefined);
  assert.equal(setup.getOptions().token, AUTH.token);
  assert.equal(setup.getOptions().logLevel, 0);
  setup.message();
  setup.reattach();
  assert.deepEqual(setup.calls.slice(-2), ['signal', 'reconnect']);
  stop();
  setup.message();
  assert.equal(setup.calls.at(-1), 'close');
});

test('renews authorization through the authenticated callback, never a master key', async () => {
  const setup = rig();
  const stop = await setup.push.subscribe(IDENTITY, setup.handlers);
  const renewed = await new Promise((resolve, reject) => {
    setup.getOptions().authCallback({}, (error, token) => error ? reject(error) : resolve(token));
  });
  assert.equal(renewed, AUTH.token);
  assert.equal(setup.getTokenCalls(), 2);
  stop();
});

test('refuses foreign identity, changed generation and unsafe channel authorization', async () => {
  for (const changed of [{ accountId: 'other' }, { deviceId: 'other' }, { generation: 2 }, { channel: '*' }, { token: '' }]) {
    const setup = rig({ requestToken: async () => ({ ...AUTH, ...changed }) });
    await assert.rejects(setup.push.subscribe(IDENTITY, setup.handlers), /Push connection unavailable/);
    assert.deepEqual(setup.calls, []);
  }
});

test('sign-out closes the client and further renewal fails safely', async () => {
  const setup = rig();
  await setup.push.subscribe(IDENTITY, setup.handlers);
  setup.controller.abort();
  assert.equal(setup.calls.at(-1), 'close');
  const error = await new Promise((resolve) => setup.getOptions().authCallback({}, (failure) => resolve(failure)));
  assert.match(error.message, /Push authorization unavailable/);
  assert.equal(setup.getTokenCalls(), 1);
});

test('cancels a stalled token request before any connection is created', async () => {
  const setup = rig({ requestToken: () => new Promise(() => {}) });
  const pending = setup.push.subscribe(IDENTITY, setup.handlers);
  setup.controller.abort();
  await assert.rejects(pending, /Push connection unavailable/);
  assert.deepEqual(setup.calls, []);
});

test('provider errors never expose credentials to the caller', async () => {
  const setup = rig({ requestToken: async () => { throw new Error('SECRET-PROVIDER-KEY'); } });
  await assert.rejects(setup.push.subscribe(IDENTITY, setup.handlers), (error) => {
    assert.equal(error.message, 'Push connection unavailable');
    assert.doesNotMatch(error.message, /SECRET/);
    return true;
  });
});