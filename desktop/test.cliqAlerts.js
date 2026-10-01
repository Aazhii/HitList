const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCliqAlerts, dueAt, MAX_PER_DAY, ERROR_BACKOFF } = require('./cliqAlerts');

// A fixed "now": 2026-10-02 12:00 on this computer's clock.
const NOW = new Date('2026-10-02T12:00:00').getTime();
const task = (id, over = {}) => ({ id, title: `Task ${id}`, status: 'TODO', dueDate: '2026-10-01', dueTime: null, ...over });

function rig(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-cliq-'));
  let clock = NOW;
  let tasks = [];
  const sent = [];
  let reply = () => ({ status: 200 });
  const alerts = createCliqAlerts({
    stateDir: dir,
    getAccount: () => ({ userId: '75733000000033001' }),
    localGet: async () => Buffer.from(JSON.stringify(tasks)),
    send: async (p, body) => { sent.push({ path: p, body }); return reply(); },
    now: () => clock,
    ...over,
  });
  return { alerts, sent, dir, setTasks: (t) => { tasks = t; }, advance: (ms) => { clock += ms; }, setReply: (r) => { reply = r; } };
}
const turnOn = (alerts) => alerts.setSettings({ enabled: true, email: 'me@zohocorp.com' });

test('a task with no time is due at the end of its day; one with a time, at that time', () => {
  assert.equal(dueAt({ dueDate: '2026-10-02', dueTime: null }), new Date('2026-10-02T23:59:59').getTime());
  assert.equal(dueAt({ dueDate: '2026-10-02', dueTime: '09:30' }), new Date('2026-10-02T09:30:00').getTime());
  assert.equal(dueAt({ dueDate: null }), null);
  assert.equal(dueAt({ dueDate: 'garbage' }), null);
});

test('does nothing unless signed in, switched on and given an email', async () => {
  const signedOut = rig({ getAccount: () => null });
  assert.equal((await signedOut.alerts.check()).result, 'signed-out');
  const off = rig();
  assert.equal((await off.alerts.check()).result, 'off');
  assert.deepEqual(off.alerts.setSettings({ enabled: true, email: 'not an email' }), { ok: false, reason: 'bad-email' });
  assert.deepEqual(off.alerts.setSettings({ enabled: true, email: 'a@b.com, c@d.com' }), { ok: false, reason: 'bad-email' });
  assert.equal(off.sent.length, 0);
});

test('switching on does not announce what is already overdue, but the next newly overdue task is announced', async () => {
  const { alerts, sent, setTasks, advance } = rig();
  setTasks([task('old1'), task('old2')]);
  turnOn(alerts);
  assert.deepEqual(await alerts.check(), { result: 'baseline', known: 2 });
  assert.equal(sent.length, 0);
  assert.equal((await alerts.check()).result, 'none');
  setTasks([task('old1'), task('old2'), task('new', { dueDate: '2026-10-02', dueTime: '11:00' })]);
  assert.deepEqual(await alerts.check(), { result: 'sent', count: 1 });
  assert.equal(sent.length, 1);
  advance(60_000);
  assert.equal((await alerts.check()).result, 'none');
  assert.equal(sent.length, 1);
});

test('several tasks that went overdue together are one message, oldest first, each told once', async () => {
  const { alerts, sent, setTasks } = rig();
  turnOn(alerts);
  await alerts.check();
  setTasks([task('b', { dueDate: '2026-10-01' }), task('a', { dueDate: '2026-09-28' }), task('c', { dueDate: '2026-09-30', dueTime: '08:00' })]);
  assert.deepEqual(await alerts.check(), { result: 'sent', count: 3 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/notify/overdue');
  assert.equal(sent[0].body.email, 'me@zohocorp.com');
  assert.deepEqual(sent[0].body.tasks.map((t) => t.title), ['Task a', 'Task c', 'Task b']);
  assert.deepEqual(sent[0].body.tasks[1], { title: 'Task c', due: '2026-09-30 08:00' });
  assert.equal((await alerts.check()).result, 'none');
});

test('done tasks and tasks not yet due are never announced, and a changed due date can alert again', async () => {
  const { alerts, sent, setTasks } = rig();
  turnOn(alerts);
  await alerts.check();
  setTasks([task('done', { status: 'DONE' }), task('later', { dueDate: '2026-10-05' }), task('nodue', { dueDate: null }), task('x', { dueDate: '2026-10-01' })]);
  assert.equal((await alerts.check()).count, 1);
  assert.equal(sent[0].body.tasks.length, 1);
  setTasks([task('x', { dueDate: '2026-10-02', dueTime: '08:00' })]);
  assert.equal((await alerts.check()).result, 'sent');
  assert.equal(sent.length, 2);
});

test('at most three alerts a day; the limit lifts the next day', async () => {
  const { alerts, sent, setTasks, advance } = rig();
  turnOn(alerts);
  await alerts.check();
  for (let i = 0; i < MAX_PER_DAY; i++) { setTasks([task(`t${i}`)]); assert.equal((await alerts.check()).result, 'sent'); }
  setTasks([task('t-extra')]);
  assert.equal((await alerts.check()).result, 'daily-limit');
  assert.equal(sent.length, MAX_PER_DAY);
  advance(24 * 60 * 60 * 1000);
  assert.equal((await alerts.check()).result, 'sent');
  assert.equal(sent.length, MAX_PER_DAY + 1);
});

test('offline is quiet and the task is still told next time; a 401 asks to sign in again; a server error backs off for an hour', async () => {
  const r = rig();
  turnOn(r.alerts);
  await r.alerts.check();
  r.setTasks([task('a')]);
  r.setReply(() => { throw new Error('ENOTFOUND'); });
  assert.equal((await r.alerts.check()).result, 'offline');
  r.setReply(() => ({ status: 401 }));
  assert.equal((await r.alerts.check()).result, 'sign-in-needed');
  r.setReply(() => ({ status: 502 }));
  assert.equal((await r.alerts.check()).result, 'error');
  r.setReply(() => ({ status: 200 }));
  assert.equal((await r.alerts.check()).result, 'backoff');
  r.advance(ERROR_BACKOFF + 1000);
  assert.deepEqual(await r.alerts.check(), { result: 'sent', count: 1 });
  assert.equal(r.alerts.status().sentToday, 1);
});

test('a rejected email is reported, and changing the email starts fresh', async () => {
  const r = rig();
  turnOn(r.alerts);
  await r.alerts.check();
  r.setTasks([task('a')]);
  r.setReply(() => ({ status: 400 }));
  assert.equal((await r.alerts.check()).result, 'bad-recipient');
  r.alerts.setSettings({ enabled: true, email: 'other@zohocorp.com' });
  r.advance(ERROR_BACKOFF + 1000);
  assert.equal((await r.alerts.check()).result, 'baseline');
});

test('the test message is sent on request, does not count towards the day, and says why when it cannot', async () => {
  const r = rig();
  assert.equal((await r.alerts.sendTest()).result, 'bad-email');
  turnOn(r.alerts);
  assert.equal((await r.alerts.sendTest()).result, 'sent');
  assert.equal(r.sent[0].path, '/notify/test');
  assert.equal(r.alerts.status().sentToday, 0);
  r.setReply(() => ({ status: 503 }));
  assert.equal((await r.alerts.sendTest()).result, 'not-configured');
  r.setReply(() => ({ status: 401 }));
  assert.equal((await r.alerts.sendTest()).result, 'sign-in-needed');
  assert.equal((await rig({ getAccount: () => null }).alerts.sendTest()).result, 'signed-out');
});

test('a local server problem is reported without sending anything', async () => {
  const r = rig({ localGet: async () => { throw new Error('refused'); } });
  turnOn(r.alerts);
  assert.equal((await r.alerts.check()).result, 'local-error');
  assert.equal(r.sent.length, 0);
});
