const fs = require('node:fs');
const path = require('node:path');

const TICK = 60_000;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const workspaceKey = (workspace) => workspace || 'personal';

function createCliqAlerts({ stateDir, localPost, send, getAccount, getWorkspace = () => null, now = () => Date.now() }) {
  const settingsFile = path.join(stateDir, 'cliq-settings-v2.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
  const write = (value) => fs.writeFileSync(settingsFile, JSON.stringify(value), { mode: 0o600 });
  let running = null;
  let controller = null;
  let generation = 0;
  let lastAttemptAt = null;
  let cursor = '';

  function getSettings(workspaceId = getWorkspace(), accountId = getAccount()?.userId) {
    const value = read()[accountId]?.[workspaceKey(workspaceId)] || {};
    return { enabled: value.enabled === true, email: typeof value.email === 'string' ? value.email : '' };
  }

  function cancel() { generation++; controller?.abort(); }

  function setSettings({ enabled, email, workspaceId = getWorkspace(), accountId = getAccount()?.userId }) {
    if (!accountId || getAccount()?.userId !== accountId) return { ok: false, reason: 'signed-out' };
    if (workspaceId !== null && !/^[A-Za-z0-9_-]{43}$/.test(workspaceId)) return { ok: false, reason: 'unknown-workspace' };
    const clean = String(email || '').trim();
    if (enabled && !EMAIL.test(clean)) return { ok: false, reason: 'bad-email' };
    cancel();
    const all = read();
    all[accountId] ||= {};
    all[accountId][workspaceKey(workspaceId)] = { enabled: !!enabled, email: clean, lastResult: null, lastSentAt: null };
    write(all);
    return { ok: true, settings: getSettings(workspaceId) };
  }

  function status(workspaceId = getWorkspace()) {
    const accountId = getAccount()?.userId || null;
    const entry = read()[accountId]?.[workspaceKey(workspaceId)] || {};
    return { ...getSettings(workspaceId), accountId, workspaceId, lastResult: entry.lastResult || null, lastSentAt: entry.lastSentAt || null };
  }

  function record(accountId, workspaceId, patch) {
    const all = read();
    const entry = all[accountId]?.[workspaceKey(workspaceId)];
    if (entry) { Object.assign(entry, patch); write(all); }
  }

  async function run() {
    const accountId = getAccount()?.userId;
    if (!accountId) return { result: 'signed-out' };
    const settings = read()[accountId] || {};
    const enabled = Object.keys(settings).filter((key) => settings[key].enabled && EMAIL.test(settings[key].email || '')).sort();
    if (!enabled.length) return { result: 'off' };
    if (lastAttemptAt !== null && now() - lastAttemptAt < TICK) return { result: 'throttled' };
    const start = enabled.findIndex((key) => key > cursor);
    const ordered = [...enabled.slice(start < 0 ? 0 : start), ...enabled.slice(0, start < 0 ? 0 : start)];
    const epoch = generation;
    controller = new AbortController();
    const signal = controller.signal;
    const current = () => generation === epoch && !signal.aborted && getAccount()?.userId === accountId;
    const options = { accountIdentity: accountId, signal, isCurrent: current };
    let localError = false;
    for (const key of ordered) {
      if (!current()) return { result: 'cancelled' };
      const workspaceId = key === 'personal' ? null : key;
      const email = settings[key].email;
      const context = { workspaceId };
      const post = async (operation, body) => {
        const reply = await localPost(`/api/overdue/${operation}`, { ...context, ...body }, options);
        if (reply.status !== 200) throw new Error(`local ${reply.status}`);
        return reply.json;
      };
      let batch;
      try {
        batch = await post('reserve', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        if (!current()) return { result: 'cancelled' };
        if (!Array.isArray(batch.tasks) || !batch.tasks.length) continue;
        batch.tasks = (await post('validate', { batchId: batch.batchId })).tasks;
        if (!current()) return { result: 'cancelled' };
        if (!Array.isArray(batch.tasks) || !batch.tasks.length) continue;
      } catch { localError = true; continue; }
      cursor = key;
      lastAttemptAt = now();
      const receipts = batch.tasks.map(({ id, occurrence }) => ({ id, occurrence }));
      let result;
      try {
        const reply = await send('/notify/overdue', {
          email,
          tasks: batch.tasks.map((task) => ({ title: String(task.title).slice(0, 120), due: task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate })),
          total: batch.tasks.length,
        }, options);
        result = reply.status === 200 ? 'sent' : reply.status === 401 ? 'sign-in-needed' : reply.status === 400 ? 'bad-recipient' : 'error';
      } catch { result = current() ? 'offline' : 'cancelled'; }
      if (!current()) return { result: 'cancelled' };
      try { await post(result === 'sent' ? 'ack' : 'retry', { batchId: batch.batchId, tasks: receipts }); }
      catch { result = result === 'sent' ? 'ack-error' : result; }
      if (!current()) return { result: 'cancelled' };
      record(accountId, workspaceId, { lastResult: result, ...(result === 'sent' ? { lastSentAt: now() } : {}) });
      return { result, ...(result === 'sent' ? { count: receipts.length } : {}) };
    }
    return { result: localError ? 'local-error' : 'none' };
  }

  const check = () => (running ||= run().finally(() => { running = null; controller = null; }));

  async function sendTest(workspaceId = getWorkspace(), expectedAccount = getAccount()?.userId) {
    const accountId = getAccount()?.userId;
    if (!accountId || accountId !== expectedAccount) return { result: 'signed-out' };
    const settings = getSettings(workspaceId);
    if (!EMAIL.test(settings.email)) return { result: 'bad-email' };
    const epoch = generation;
    const isCurrent = () => generation === epoch && getAccount()?.userId === accountId;
    try {
      const reply = await send('/notify/test', { email: settings.email }, { accountIdentity: accountId, isCurrent, signal: AbortSignal.timeout(10_000) });
      if (!isCurrent()) return { result: 'cancelled' };
      return { result: reply.status === 200 ? 'sent' : reply.status === 401 ? 'sign-in-needed' : reply.status === 400 ? 'bad-recipient' : reply.status === 503 ? 'not-configured' : 'error' };
    } catch { return { result: isCurrent() ? 'offline' : 'cancelled' }; }
  }

  function startSchedule({ firstCheckMs = 0, tickMs = Number(process.env.HITLIST_CLIQ_TICK_MS) || TICK } = {}) {
    const tick = () => { void check().catch(() => {}); };
    const first = setTimeout(tick, firstCheckMs);
    const timer = setInterval(tick, tickMs);
    return () => { clearTimeout(first); clearInterval(timer); cancel(); };
  }

  return { getSettings, setSettings, status, check, sendTest, startSchedule, cancel };
}

module.exports = { createCliqAlerts };
