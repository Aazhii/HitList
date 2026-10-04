'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspacePush } = require('./workspacePush');

const WS_A = 'a'.repeat(43);
const WS_B = 'b'.repeat(43);
const CH = (c) => `hitlist:ws:${c.repeat(64)}`;
const AUTH = { token: 'subscribe-only', channels: { [WS_A]: CH('a'), [WS_B]: CH('b') } };

function rig(auth = AUTH) {
  const calls = [];
  const handlers = {};
  let options;
  let tokens = 0;
  const push = createWorkspacePush({
    requestToken: async () => { tokens += 1; return typeof auth === 'function' ? auth() : auth; },
    createRealtime: (o) => {
      options = o;
      return {
        channels: { get: (name) => ({
          on: (event, handler) => { handlers[`${name}:${event}`] = handler; },
          off: () => calls.push(`off ${name}`),
          subscribe: async (event, h) => { calls.push(`subscribe ${name} ${event}`); handlers[name] = h; },
          unsubscribe: () => calls.push(`unsubscribe ${name}`),
        }) },
        connect: () => calls.push('connect'),
        close: () => calls.push('close'),
      };
    },
  });
  return { push, calls, handlers, getOptions: () => options, tokens: () => tokens };
}

test('listens on every workspace channel and passes only the workspace and number on', async () => {
  const r = rig(); const c = new AbortController(); const seen = [];
  const stop = await r.push.subscribe({ signal: c.signal, onSignal: (id, seq) => seen.push([id, seq]), onReconnect: () => seen.push('reconnect') });
  assert.deepEqual(r.calls.filter((x) => x.startsWith('subscribe')), [`subscribe ${CH('a')} workspace-changed`, `subscribe ${CH('b')} workspace-changed`]);
  r.handlers[CH('b')]({ data: { seq: 9, ignored: 'never executed' } });
  r.handlers[CH('a')]({ data: {} });
  assert.deepEqual(seen, [[WS_B, 9], [WS_A, null]]);
  stop();
  assert.ok(r.calls.includes('close'));
  r.handlers[CH('a')]({ data: { seq: 1 } });
  assert.equal(seen.length, 2, 'nothing after stop');
});

test('the first attach is quiet; later re-attaches make the engine catch up', async () => {
  const r = rig(); const c = new AbortController(); let reconnects = 0;
  await r.push.subscribe({ signal: c.signal, onSignal: () => {}, onReconnect: () => { reconnects += 1; } });
  r.handlers[`${CH('a')}:attached`](); r.handlers[`${CH('b')}:attached`]();
  assert.equal(reconnects, 0);
  r.handlers[`${CH('a')}:attached`]();
  assert.equal(reconnects, 1);
});

test('no workspaces means nothing to listen to', async () => {
  const r = rig({ token: null, channels: {} });
  assert.equal(await r.push.subscribe({ signal: new AbortController().signal, onSignal() {}, onReconnect() {} }), null);
  assert.equal(r.calls.length, 0);
});

test('a bad authorization is refused: wrong channel shape, oversized or missing token', async () => {
  for (const bad of [
    { token: 't', channels: { [WS_A]: 'hitlist:inbox:abc' } },
    { token: 't', channels: { short: CH('a') } },
    { token: '', channels: { [WS_A]: CH('a') } },
    { token: 'x'.repeat(9000), channels: { [WS_A]: CH('a') } },
    null,
  ]) {
    await assert.rejects(rig(bad).push.subscribe({ signal: new AbortController().signal, onSignal() {}, onReconnect() {} }), /Invalid push authorization/);
  }
});

test('token renewal goes back to the cloud; a bad renewal is refused', async () => {
  let n = 0;
  const r = rig(() => (n++ === 0 ? AUTH : { token: '', channels: AUTH.channels }));
  await r.push.subscribe({ signal: new AbortController().signal, onSignal() {}, onReconnect() {} });
  const first = await new Promise((resolve) => r.getOptions().authCallback({}, (err, tok) => resolve([err, tok])));
  assert.equal(first[0] instanceof Error, true);
  assert.equal(r.tokens(), 2);
});

test('cancelling stops listening', async () => {
  const r = rig(); const c = new AbortController();
  await r.push.subscribe({ signal: c.signal, onSignal() {}, onReconnect() {} });
  c.abort();
  assert.ok(r.calls.includes('close'));
});

test('a channel failure closes the client and requests recovery once', async () => {
  const r = rig();
  let failures = 0;
  await r.push.subscribe({ signal: new AbortController().signal, onSignal() {}, onReconnect() {}, onUnavailable: () => { failures += 1; } });
  r.handlers[`${CH('a')}:failed`]();
  r.handlers[`${CH('b')}:suspended`]();
  assert.equal(failures, 1);
  assert.ok(r.calls.includes('close'));
});
