/**
 * Telling the person in Zoho Cliq when a task becomes overdue. Pure of Electron, like backup.js: everything it touches is
 * passed in, so the rules can be tested without a window or a network.
 *
 *   localGet(path)         -> Buffer   the local server's answer (the signed-in account's tasks)
 *   send(path, payload)    -> { status }   one POST to the Catalyst Function (/notify/overdue or /notify/test)
 *   getAccount()           -> { userId } | null
 *
 * Overdue is only known here (the tasks are on this computer), so alerts go out only while HitList is open. Each check makes
 * at most ONE call, for everything that became overdue since the last one, and at most three a day. The Cliq token is never
 * here: the Function holds it.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_PER_DAY = 3;
const ERROR_BACKOFF = 60 * 60 * 1000;
const TICK = 15 * 60 * 1000;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** The moment a task is due on this computer's clock; a task with no time is due at the end of its day. */
function dueAt(task) {
  if (!task.dueDate) return null;
  const time = /^\d{2}:\d{2}$/.test(task.dueTime || '') ? `${task.dueTime}:00` : '23:59:59';
  const ms = new Date(`${task.dueDate}T${time}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}
const dueKey = (task) => `${task.dueDate} ${task.dueTime || ''}`.trim();
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function createCliqAlerts({ stateDir, localGet, send, getAccount, now = () => Date.now() }) {
  const settingsFile = path.join(stateDir, 'cliq-settings.json');
  const stateFile = path.join(stateDir, 'cliq-state.json');
  const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const patchState = (patch) => write(stateFile, { ...read(stateFile), ...patch });
  let running = null;

  function getSettings() {
    const s = read(settingsFile);
    return { enabled: !!s.enabled, email: typeof s.email === 'string' ? s.email : '' };
  }

  /** Saves the switch and the Cliq email. Turning it on, or changing the email, starts fresh: tasks already overdue are not announced. */
  function setSettings({ enabled, email }) {
    const clean = String(email || '').trim();
    if (enabled && !EMAIL.test(clean)) return { ok: false, reason: 'bad-email' };
    const before = read(settingsFile);
    const fresh = enabled && (!before.enabled || before.email !== clean);
    write(settingsFile, { enabled: !!enabled, email: clean || before.email || '', baselined: fresh ? false : !!before.baselined });
    return { ok: true, settings: getSettings() };
  }

  function status() {
    const state = read(stateFile);
    const today = dayOf(now());
    return { ...getSettings(), lastResult: state.lastResult || null, lastSentAt: state.lastSentAt || null, sentToday: state.sent && state.sent.day === today ? state.sent.count : 0, maxPerDay: MAX_PER_DAY };
  }

  async function run() {
    const account = getAccount();
    const settings = read(settingsFile);
    if (!account) return { result: 'signed-out' };
    if (!settings.enabled || !EMAIL.test(settings.email || '')) return { result: 'off' };
    const state = read(stateFile);
    if (state.backoffUntil && state.backoffUntil > now()) return { result: 'backoff' };

    let tasks;
    try { tasks = JSON.parse((await localGet('/api/tasks')).toString('utf8')); if (!Array.isArray(tasks)) throw new Error('not a list'); }
    catch { return { result: 'local-error' }; }

    const t = now();
    const overdue = tasks.filter((x) => x.status !== 'DONE' && dueAt(x) !== null && dueAt(x) < t);
    // Forget tasks that are done, deleted, no longer overdue, or whose due date changed.
    const notified = {};
    for (const x of overdue) if (state.notified && state.notified[x.id] === dueKey(x)) notified[x.id] = dueKey(x);

    if (!settings.baselined) {
      for (const x of overdue) notified[x.id] = dueKey(x);
      write(settingsFile, { ...settings, baselined: true });
      patchState({ notified, lastResult: 'baseline' });
      return { result: 'baseline', known: overdue.length };
    }

    const fresh = overdue.filter((x) => notified[x.id] !== dueKey(x)).sort((a, b) => dueAt(a) - dueAt(b));
    if (fresh.length === 0) { patchState({ notified }); return { result: 'none' }; }

    const today = dayOf(t);
    const sent = state.sent && state.sent.day === today ? state.sent : { day: today, count: 0 };
    if (sent.count >= MAX_PER_DAY) { patchState({ notified, lastResult: 'daily-limit' }); return { result: 'daily-limit' }; }

    let reply;
    try {
      reply = await send('/notify/overdue', {
        email: settings.email,
        tasks: fresh.map((x) => ({ title: x.title, due: x.dueTime ? `${x.dueDate} ${x.dueTime}` : x.dueDate })),
        total: fresh.length,
      });
    } catch { patchState({ notified }); return { result: 'offline' }; }

    if (reply.status === 200) {
      for (const x of fresh) notified[x.id] = dueKey(x);
      patchState({ notified, sent: { day: today, count: sent.count + 1 }, lastSentAt: t, lastResult: 'sent', backoffUntil: null });
      return { result: 'sent', count: fresh.length };
    }
    patchState({ notified });
    if (reply.status === 401) { patchState({ lastResult: 'sign-in-needed' }); return { result: 'sign-in-needed' }; }
    const result = reply.status === 400 ? 'bad-recipient' : 'error';
    patchState({ lastResult: result, backoffUntil: t + ERROR_BACKOFF });
    return { result, status: reply.status };
  }

  /** One check at a time. */
  const check = () => (running ||= run().finally(() => { running = null; }));

  /** A fixed test message, to prove the connection. It does not count towards the daily limit. */
  async function sendTest() {
    if (!getAccount()) return { result: 'signed-out' };
    const settings = read(settingsFile);
    if (!EMAIL.test(settings.email || '')) return { result: 'bad-email' };
    try {
      const reply = await send('/notify/test', { email: settings.email });
      if (reply.status === 200) return { result: 'sent' };
      if (reply.status === 401) return { result: 'sign-in-needed' };
      if (reply.status === 400) return { result: 'bad-recipient' };
      if (reply.status === 503) return { result: 'not-configured' };
      return { result: 'error', status: reply.status };
    } catch { return { result: 'offline' }; }
  }

  /** The timer: a first look 2 minutes after launch, then every 15 minutes (HITLIST_CLIQ_TICK_MS shortens it for testing). */
  function startSchedule({ firstCheckMs = 2 * 60 * 1000, tickMs = Number(process.env.HITLIST_CLIQ_TICK_MS) || TICK } = {}) {
    const tick = () => { void check().catch(() => {}); };
    const first = setTimeout(tick, firstCheckMs);
    const timer = setInterval(tick, tickMs);
    return () => { clearTimeout(first); clearInterval(timer); };
  }

  return { getSettings, setSettings, status, check, sendTest, startSchedule };
}

module.exports = { createCliqAlerts, dueAt, MAX_PER_DAY, ERROR_BACKOFF };
