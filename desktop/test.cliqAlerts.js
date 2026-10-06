const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCliqAlerts } = require('./cliqAlerts');

function rig(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-cliq-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = 100_000;
  let account = { userId: '75733000000033001' };
  let workspace = null;
  const requests = [], sent = [], outbox = [];
  // The automation outbox is a separate conversation with the local server; the overdue tests below only look at /api/overdue.
  const outboxHandler = overrides.outbox || (async () => ({ status: 200, json: { batchId: 'b', items: [] } }));
  const due = [{ id: 'task', occurrence: 'occurrence', title: 'Overdue', dueDate: '2026-01-01', dueTime: '10:00' }];
  // A note on the task goes along with it; this rig has none, so an empty one is sent.
  let tasks = due;
  const alerts = createCliqAlerts({
    stateDir: dir, getAccount: () => account, getWorkspace: () => workspace, now: () => clock,
    localPost: async (url, body, options) => {
      if (url.startsWith('/api/automations/outbox/')) { outbox.push({ url, body }); return outboxHandler(url, body); }
      requests.push({ url, body, options });
      return { status: 200, json: { batchId: 'batch', tasks: url.endsWith('/ack') ? (tasks = []) : tasks } };
    },
    send: async (url, body, options) => { sent.push({ url, body, options }); return { status: 200 }; },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'outbox')),
  });
  return { alerts, sent, requests, outbox, dir, due, advance: () => { clock += 60_000; },
    setAccount: (value) => { account = value; }, setWorkspace: (value) => { workspace = value; }, setTasks: (value) => { tasks = value; } };
}
const turnOn = (alerts) => alerts.setSettings({ enabled: true, email: 'me@zohocorp.com' });

test('signed-out/off/idle checks never call the cloud or scan all tasks', async (t) => {
  const r = rig(t);
  assert.equal((await r.alerts.check()).result, 'off');
  assert.equal(r.requests.length, 0);
  assert.equal(r.alerts.setSettings({ enabled: true, email: 'invalid' }).reason, 'bad-email');
  turnOn(r.alerts); r.setTasks([]);
  assert.equal((await r.alerts.check()).result, 'none');
  assert.equal(r.sent.length, 0);
  assert.ok(r.requests.every(({ url }) => url.startsWith('/api/overdue/')));
  r.setAccount(null);
  assert.equal((await r.alerts.check()).result, 'signed-out');
});

test('enabling catches up overdue tasks and acknowledges only included occurrences', async (t) => {
  const r = rig(t); turnOn(r.alerts);
  assert.deepEqual(await r.alerts.check(), { result: 'sent', count: 1 });
  assert.deepEqual(r.requests.map(({ url }) => url), ['/api/overdue/reserve', '/api/overdue/validate', '/api/overdue/ack']);
  assert.deepEqual(r.sent[0].body, { email: 'me@zohocorp.com', tasks: [{ title: 'Overdue', due: '2026-01-01 10:00', note: '' }], total: 1 });
  assert.deepEqual(r.requests[2].body.tasks, [{ id: 'task', occurrence: 'occurrence' }]);
  assert.equal(r.sent[0].options.accountIdentity, '75733000000033001');
  assert.equal((await r.alerts.check()).result, 'throttled');
  r.advance(); assert.equal((await r.alerts.check()).result, 'none');
});

test('no daily cap: one batch each minute with independent account/workspace settings', async (t) => {
  const r = rig(t); turnOn(r.alerts);
  for (let index = 0; index < 5; index++) {
    r.setTasks(r.due); assert.equal((await r.alerts.check()).result, 'sent'); r.advance();
  }
  assert.equal(r.sent.length, 5);
  r.setWorkspace('w'.repeat(43)); assert.equal(r.alerts.status().enabled, false);
  turnOn(r.alerts); r.setWorkspace(null); assert.equal(r.alerts.status().enabled, true);
  r.setAccount({ userId: 'other' }); assert.equal(r.alerts.status().enabled, false);
});

test('fair rotation continues enabled workspaces when active view changes', async (t) => {
  const r = rig(t); turnOn(r.alerts);
  const shared = 'w'.repeat(43); r.setWorkspace(shared); turnOn(r.alerts); r.setWorkspace(null);
  r.setTasks(r.due); await r.alerts.check(); r.advance(); r.setTasks(r.due); await r.alerts.check();
  assert.deepEqual(r.requests.filter(({ url }) => url.endsWith('/reserve')).map(({ body }) => body.workspaceId), [null, shared]);
});

test('failed sends retry; test messages never mark task receipts', async (t) => {
  const r = rig(t, { send: async () => ({ status: 502 }) }); turnOn(r.alerts);
  assert.equal((await r.alerts.check()).result, 'error'); assert.equal(r.requests.at(-1).url, '/api/overdue/retry');
  r.advance(); assert.equal((await r.alerts.check()).result, 'error');
  const count = r.requests.length;
  assert.equal((await r.alerts.sendTest()).result, 'error'); assert.equal(r.requests.length, count);
});

test('changed/deleted tasks between reserve and validation do not send', async (t) => {
  const r = rig(t, { localPost: async (url) => ({ status: 200, json: { batchId: 'batch', tasks: url.endsWith('/validate') ? [] : [{ id: 'deleted' }] } }) });
  turnOn(r.alerts); assert.equal((await r.alerts.check()).result, 'none'); assert.equal(r.sent.length, 0);
});

test('delayed local requests cannot send after changing accounts', async (t) => {
  let release;
  const r = rig(t, { localPost: () => new Promise((resolve) => { release = resolve; }) }); turnOn(r.alerts);
  const check = r.alerts.check(); r.setAccount({ userId: 'B' });
  release({ status: 200, json: { batchId: 'batch', tasks: r.due } });
  assert.equal((await check).result, 'cancelled'); assert.equal(r.sent.length, 0);
});

test('turning off aborts an in-flight send without acknowledging or restoring settings', async (t) => {
  let release, started;
  const ready = new Promise((resolve) => { started = resolve; });
  const r = rig(t, { send: (url, body, options) => { started(options); return new Promise((resolve) => { release = resolve; }); } });
  turnOn(r.alerts); const check = r.alerts.check(); const options = await ready;
  r.alerts.setSettings({ enabled: false, email: 'me@zohocorp.com' });
  assert.equal(options.signal.aborted, true); assert.equal(options.isCurrent(), false);
  release({ status: 200 }); assert.equal((await check).result, 'cancelled');
  assert.equal(r.alerts.status().enabled, false); assert.ok(!r.requests.some(({ url }) => url.endsWith('/ack')));
});

test('single flight and legacy unscoped settings are not adopted', async (t) => {
  const r = rig(t);
  fs.writeFileSync(path.join(r.dir, 'cliq-settings.json'), JSON.stringify({ enabled: true, email: 'old@zohocorp.com' }));
  assert.equal(r.alerts.status().enabled, false); turnOn(r.alerts);
  const first = r.alerts.check(); assert.equal(first, r.alerts.check()); await first;
  assert.equal(r.sent.length, 1);
});

// ── automation outbox: messages rules queued for the Cliq bot ──────────────────────────────────────────────────────────────

function outboxRig(t, items, extra = {}) {
  const calls = [];
  const state = { items };
  const r = rig(t, {
    outbox: async (url, body) => {
      calls.push({ url, body });
      if (url.endsWith('/reserve')) return { status: 200, json: { batchId: 'b-1', items: state.items } };
      if (url.endsWith('/validate')) return { status: 200, json: { items: (extra.live || state.items) } };
      return { status: 200, json: { ok: true } };
    },
    ...extra.overrides,
  });
  return { ...r, calls };
}
const item = (id, text) => ({ id, ruleId: 'rule', payload: JSON.stringify({ text }) });

test('queued automation messages go to the saved Cliq address and are acknowledged', async (t) => {
  const r = outboxRig(t, [item('1', 'Hello one'), item('2', 'Hello two')]);
  r.alerts.setSettings({ enabled: false, email: 'me@zohocorp.com' }); // overdue alerts off: the saved address is still used
  const out = await r.alerts.runOutbox();
  assert.deepEqual(out, { result: 'sent', count: 2 });
  assert.deepEqual(r.sent.map((m) => [m.url, m.body]), [
    ['/notify/message', { email: 'me@zohocorp.com', text: 'Hello one' }],
    ['/notify/message', { email: 'me@zohocorp.com', text: 'Hello two' }],
  ]);
  assert.deepEqual(r.calls.map((c) => c.url), ['/api/automations/outbox/reserve', '/api/automations/outbox/validate', '/api/automations/outbox/ack']);
  assert.deepEqual(r.calls[2].body, { batchId: 'b-1', ids: ['1', '2'] });
});

test('without a saved Cliq address nothing is reserved, so nothing is lost', async (t) => {
  const r = outboxRig(t, [item('1', 'x')]);
  assert.deepEqual(await r.alerts.runOutbox(), { result: 'no-email' });
  assert.equal(r.calls.length, 0);
  r.setAccount(null);
  assert.deepEqual(await r.alerts.runOutbox(), { result: 'signed-out' });
});

test('a failed send is handed back to be retried, and one refusal stops the rest of the batch', async (t) => {
  const r = outboxRig(t, [item('1', 'a'), item('2', 'b'), item('3', 'c')], { overrides: { send: async () => ({ status: 502 }) } });
  r.alerts.setSettings({ enabled: false, email: 'me@zohocorp.com' });
  const out = await r.alerts.runOutbox();
  assert.equal(out.result, 'error');
  assert.ok(!r.calls.some((c) => c.url.endsWith('/ack')));
  assert.deepEqual(r.calls.find((c) => c.url.endsWith('/retry')).body.ids.sort(), ['1', '2', '3']);

  let attempts = 0;
  const r2 = outboxRig(t, [item('1', 'a'), item('2', 'b')], { overrides: { send: async () => { attempts += 1; return { status: 401 }; } } });
  r2.alerts.setSettings({ enabled: false, email: 'me@zohocorp.com' });
  await r2.alerts.runOutbox();
  assert.equal(attempts, 1, 'a sign-in problem is not tried again for each message');
  assert.deepEqual(r2.calls.find((c) => c.url.endsWith('/retry')).body.ids.sort(), ['1', '2']);
});

test('a message whose rule was paused or deleted meanwhile is dropped, not sent', async (t) => {
  const r = outboxRig(t, [item('1', 'wanted'), item('2', 'dropped')], { live: [item('1', 'wanted')] });
  r.alerts.setSettings({ enabled: false, email: 'me@zohocorp.com' });
  const out = await r.alerts.runOutbox();
  assert.deepEqual(out, { result: 'sent', count: 1 });
  assert.deepEqual(r.sent.map((m) => m.body.text), ['wanted']);
  assert.deepEqual(r.calls.find((c) => c.url.endsWith('/ack')).body.ids.sort(), ['1', '2']);
});

test('the regular check also delivers the outbox, and an empty outbox does nothing', async (t) => {
  const r = outboxRig(t, [item('1', 'from a rule')]);
  r.setTasks([]);
  r.alerts.setSettings({ enabled: true, email: 'me@zohocorp.com' });
  await r.alerts.check();
  assert.deepEqual(r.sent.map((m) => m.body.text), ['from a rule']);
  const empty = outboxRig(t, []);
  empty.alerts.setSettings({ enabled: false, email: 'me@zohocorp.com' });
  assert.deepEqual(await empty.alerts.runOutbox(), { result: 'none' });
  assert.equal(empty.sent.length, 0);
});

test('a test message with the rule\'s own text goes to the saved address, and says why it cannot', async (t) => {
  const r = rig(t);
  assert.deepEqual(await r.alerts.sendMessage('hi'), { result: 'bad-email' });
  r.alerts.setSettings({ enabled: false, email: 'me@zohocorp.com' });
  assert.equal(r.alerts.addressFor(), 'me@zohocorp.com');
  assert.deepEqual(await r.alerts.sendMessage('  Hello from a rule  '), { result: 'sent' });
  assert.deepEqual(r.sent[0].body, { email: 'me@zohocorp.com', text: 'Hello from a rule' });
  assert.equal(r.sent[0].url, '/notify/message');
  assert.deepEqual(await r.alerts.sendMessage('   '), { result: 'error' });
  r.setAccount({ userId: 'other' });
  assert.deepEqual(await r.alerts.sendMessage('x', '75733000000033001'), { result: 'signed-out' });
});
