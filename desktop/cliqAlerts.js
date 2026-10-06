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
          tasks: batch.tasks.map((task) => ({ title: String(task.title).slice(0, 120), due: task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate, note: typeof task.note === 'string' ? task.note.slice(0, 1000) : '' })),
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

  /** The Cliq address saved for this account (the personal one first, else any), or null. Automation rules message this address. */
  function addressFor(accountId = getAccount()?.userId) {
    const all = read()[accountId] || {};
    return [all.personal, ...Object.values(all)].map((e) => e && e.email).find((e) => typeof e === 'string' && EMAIL.test(e)) || null;
  }

  /** Sends one message with the given text to the saved address (the rule builder's "send a test with this message"). */
  async function sendMessage(text, expectedAccount = getAccount()?.userId) {
    const accountId = getAccount()?.userId;
    if (!accountId || accountId !== expectedAccount) return { result: 'signed-out' };
    const email = addressFor(accountId);
    if (!email) return { result: 'bad-email' };
    const clean = String(text || '').trim().slice(0, 1900);
    if (!clean) return { result: 'error' };
    const epoch = generation;
    const isCurrent = () => generation === epoch && getAccount()?.userId === accountId;
    try {
      const reply = await send('/notify/message', { email, text: clean }, { accountIdentity: accountId, isCurrent, signal: AbortSignal.timeout(10_000) });
      if (!isCurrent()) return { result: 'cancelled' };
      return { result: reply.status === 200 ? 'sent' : reply.status === 401 ? 'sign-in-needed' : reply.status === 400 ? 'bad-recipient' : reply.status === 429 ? 'error' : reply.status === 503 ? 'not-configured' : 'error' };
    } catch { return { result: isCurrent() ? 'offline' : 'cancelled' }; }
  }

  /**
   * Delivers the messages automation rules queued for the Cliq bot (the local server's outbox). It needs only the Cliq address
   * saved in Account → Cliq alerts, not the overdue-alerts switch. At most one batch of ten per call. A message whose rule was
   * paused or deleted since is dropped, never sent.
   */
  async function runOutbox() {
    const accountId = getAccount()?.userId;
    if (!accountId) return { result: 'signed-out' };
    const email = addressFor(accountId);
    if (!email) return { result: 'no-email' };
    const epoch = generation;
    const outboxController = new AbortController();
    const signal = outboxController.signal;
    const current = () => generation === epoch && !signal.aborted && getAccount()?.userId === accountId;
    const options = { accountIdentity: accountId, signal, isCurrent: current };
    const post = async (operation, body) => {
      const reply = await localPost(`/api/automations/outbox/${operation}`, body, options);
      if (reply.status !== 200) throw new Error(`local ${reply.status}`);
      return reply.json;
    };
    let batch;
    let live;
    try {
      batch = await post('reserve', {});
      if (!Array.isArray(batch.items) || !batch.items.length) return { result: 'none' };
      live = (await post('validate', { batchId: batch.batchId })).items;
    } catch { return { result: 'local-error' }; }
    if (!current()) return { result: 'cancelled' };
    const liveIds = new Set((Array.isArray(live) ? live : []).map((item) => item.id));
    const sent = batch.items.filter((item) => !liveIds.has(item.id)).map((item) => item.id); // no longer wanted: dropped
    const failed = [];
    let delivered = 0;
    for (const item of batch.items.filter((entry) => liveIds.has(entry.id))) {
      let text = '';
      try { text = String(JSON.parse(item.payload).text || ''); } catch { /* unreadable: dropped below */ }
      if (!text) { sent.push(item.id); continue; }
      let status = 0;
      try { status = (await send('/notify/message', { email, text }, options)).status; } catch { status = 0; }
      if (!current()) return { result: 'cancelled' };
      if (status === 200) { sent.push(item.id); delivered++; } else failed.push(item.id);
      if (status === 401 || status === 400 || status === 0) {
        // A refusal or no connection will fail the rest the same way: hand them all back and stop.
        failed.push(...batch.items.filter((entry) => liveIds.has(entry.id) && !sent.includes(entry.id) && !failed.includes(entry.id)).map((entry) => entry.id));
        break;
      }
    }
    try {
      if (sent.length) await post('ack', { batchId: batch.batchId, ids: sent });
      if (failed.length) await post('retry', { batchId: batch.batchId, ids: failed });
    } catch { return { result: 'ack-error', count: delivered }; }
    return { result: failed.length ? 'error' : 'sent', count: delivered };
  }

  const check = () => (running ||= (async () => {
    const overdue = await run();
    try { await runOutbox(); } catch { /* retried on the next tick */ }
    return overdue;
  })().finally(() => { running = null; controller = null; }));

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

  return { getSettings, setSettings, status, check, runOutbox, addressFor, sendMessage, sendTest, startSchedule, cancel };
}

module.exports = { createCliqAlerts };
