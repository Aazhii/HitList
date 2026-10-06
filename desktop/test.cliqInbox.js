'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCliqInbox } = require('./cliqInbox');

const NOW = 1_800_000_000_000;
const LINK = { enabled: true, accountId: 'account-a', deviceId: 'device-a', generation: 1 };
const command = (id, overrides = {}) => ({
  id, accountId: LINK.accountId, deviceId: LINK.deviceId, generation: LINK.generation,
  schemaVersion: 1, type: 'create', payload: { title: 'From Cliq' }, expiresAt: NOW + 60_000, ...overrides,
});

function rig(overrides = {}) {
  let link = { ...LINK };
  let callbacks;
  let pending = [];
  const calls = [];
  const receipts = new Map();
  const mutations = [];
  const worker = createCliqInbox({
    getLink: () => link,
    now: () => NOW,
    subscribe: async (_identity, handlers) => {
      calls.push('subscribe');
      callbacks = handlers;
      return () => calls.push('unsubscribe');
    },
    fetchPending: async (_identity, { limit }) => {
      calls.push('fetch');
      return pending.slice(0, limit);
    },
    execute: async (item) => {
      calls.push(`execute:${item.id}`);
      if (!receipts.has(item.id)) {
        mutations.push(item.id);
        receipts.set(item.id, { status: 'applied', taskId: `task-${item.id}` });
      }
      return receipts.get(item.id);
    },
    acknowledge: async (id) => {
      calls.push(`ack:${id}`);
      pending = pending.filter((item) => item.id !== id);
    },
    onApplied: ({ commandId }) => calls.push(`refresh:${commandId}`),
    ...overrides,
  });
  return {
    worker, calls, mutations, receipts,
    setLink: (value) => { link = value; },
    setPending: (value) => { pending = value; },
    signal: () => callbacks.onSignal(),
    reconnect: () => callbacks.onReconnect(),
  };
}

test('subscribes before catch-up, executes before ACK and refreshes local changes', async () => {
  const setup = rig();
  setup.setPending([command('one')]);
  assert.deepEqual(await setup.worker.start(), { result: 'idle', processed: 1 });
  assert.deepEqual(setup.calls, ['subscribe', 'fetch', 'execute:one', 'refresh:one', 'ack:one', 'fetch']);
  setup.worker.stop();
  assert.equal(setup.calls.at(-1), 'unsubscribe');
});

test('requires an enabled verified account and device generation', async () => {
  for (const link of [null, { ...LINK, enabled: false }, { ...LINK, generation: 0 }, { ...LINK, deviceId: '' }]) {
    const setup = rig();
    setup.setLink(link);
    assert.equal((await setup.worker.start()).result, 'inactive');
    assert.deepEqual(setup.calls, []);
  }
});

test('reconnect collects commands queued while offline and duplicate signals do not duplicate mutations', async () => {
  const setup = rig();
  await setup.worker.start();
  setup.setPending([command('one'), command('two')]);
  await Promise.all([setup.signal(), setup.signal(), setup.reconnect()]);
  assert.deepEqual(setup.mutations, ['one', 'two']);
  await setup.signal();
  assert.deepEqual(setup.mutations, ['one', 'two']);
});

test('a failed ACK leaves work retryable using the executor durable receipt', async () => {
  let fail = true;
  const setup = rig({ acknowledge: async () => { if (fail) throw new Error('offline'); setup.setPending([]); } });
  setup.setPending([command('one')]);
  assert.equal((await setup.worker.start()).result, 'retry-needed');
  assert.deepEqual(setup.mutations, ['one']);
  fail = false;
  assert.equal((await setup.worker.fetchNow()).result, 'idle');
  assert.deepEqual(setup.mutations, ['one']);
});

test('rejects foreign, stale and malformed inbox envelopes before any local action', async () => {
  for (const invalid of [
    command('other', { accountId: 'account-b' }), command('old', { generation: 2 }),
    command('device', { deviceId: 'device-b' }), command('future', { schemaVersion: 2 }),
    command('shell', { type: 'shell' }), command('bad', { payload: [] }), command('../path'),
    command('x'.repeat(65)),
  ]) {
    const setup = rig();
    setup.setPending([command('valid'), invalid]);
    assert.equal((await setup.worker.start()).result, 'invalid-inbox');
    assert.deepEqual(setup.mutations, []);
    assert.equal(setup.calls.some((entry) => entry.startsWith('ack:')), false);
  }
});

test('expires queued commands without executing them', async () => {
  let result;
  const setup = rig({ acknowledge: async (_id, outcome) => { result = outcome; setup.setPending([]); } });
  setup.setPending([command('expired', { expiresAt: NOW })]);
  assert.equal((await setup.worker.start()).processed, 1);
  assert.deepEqual(result, { status: 'expired' });
  assert.deepEqual(setup.mutations, []);
});

test('account switch during fetch prevents local execution and ACK', async () => {
  let resolveFetch;
  const setup = rig({ fetchPending: () => new Promise((resolve) => { resolveFetch = resolve; }) });
  const running = setup.worker.start();
  await Promise.resolve();
  setup.setLink({ ...LINK, accountId: 'account-b' });
  resolveFetch([command('one')]);
  assert.equal((await running).result, 'inactive');
  assert.deepEqual(setup.mutations, []);
  assert.equal(setup.worker.status().active, false);
  await setup.worker.fetchNow();
  assert.equal(setup.calls.at(-1), 'unsubscribe');
});

test('sign-out during execution aborts transport and prevents cloud ACK', async () => {
  let resolveExecute;
  let executionSignal;
  const setup = rig({ execute: (_item, context) => {
    executionSignal = context.signal;
    return new Promise((resolve) => { resolveExecute = resolve; });
  } });
  setup.setPending([command('one')]);
  const running = setup.worker.start();
  await Promise.resolve();
  await Promise.resolve();
  setup.setLink(null);
  setup.worker.stop();
  resolveExecute({ status: 'applied' });
  assert.equal((await running).result, 'inactive');
  assert.equal(executionSignal.aborted, true);
  assert.equal(setup.calls.some((entry) => entry.startsWith('ack:')), false);
});

test('subscription failure is retryable and no inbox is fetched without an attached subscription', async () => {
  let failed = true;
  const setup = rig({ subscribe: async () => { if (failed) throw new Error('provider down'); return () => {}; } });
  assert.equal((await setup.worker.start()).result, 'connection-error');
  assert.deepEqual(setup.calls, []);
  failed = false;
  assert.equal((await setup.worker.start()).result, 'idle');
  assert.deepEqual(setup.calls, ['fetch']);
});

test('bounds pages when the server repeatedly returns already acknowledged work', async () => {
  const setup = rig({ acknowledge: async () => {} });
  setup.setPending([command('one')]);
  assert.equal((await setup.worker.start()).result, 'batch-limit');
  assert.equal(setup.calls.filter((entry) => entry === 'fetch').length, 10);
  assert.deepEqual(setup.mutations, ['one']);
});

test('collects paginated pending work and does not refresh UI for list results', async () => {
  const setup = rig();
  setup.setPending(Array.from({ length: 25 }, (_, index) => command(`task-${index}`, { type: 'list' })));
  assert.deepEqual(await setup.worker.start(), { result: 'idle', processed: 25 });
  assert.equal(setup.calls.filter((entry) => entry === 'fetch').length, 3);
  assert.equal(setup.calls.some((entry) => entry.startsWith('refresh:')), false);
});