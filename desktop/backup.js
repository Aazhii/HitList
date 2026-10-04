/**
 * Backing up the local workspace to Catalyst (D3). Pure of Electron: everything it touches is passed in, so the rules
 * can be tested without a window or a network.
 *
 *   localGet(path)        -> Buffer   the local server's answer (the snapshot, as the signed-in account)
 *   upload(bytes, hash)   -> { status, body }   one PUT to the backup Function
 *   getAccount()          -> { userId } | null
 *
 * The cloud is only asked when something changed: each tick takes a snapshot from the local server and hashes what is in
 * it. The export time and the order rows come back in are left out of the hash, so only a real change counts.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/** A scheduled backup is due when the last good one is this old. (Signing out and "Back up now" back up sooner.) */
const BACKUP_INTERVAL = 3 * 24 * 60 * 60 * 1000;
/** After a server error, the scheduled backup waits this long before trying again (the free tier counts every call). */
const ERROR_BACKOFF = 60 * 60 * 1000;

/** The same workspace always gives the same hash: tables and rows are put in a fixed order, the export time is ignored. */
function contentHash(snapshot) {
  const tables = Object.keys(snapshot.tables || {}).sort().map((name) => [
    name, (snapshot.tables[name] || []).map((row) => JSON.stringify(row)).sort(),
  ]);
  return crypto.createHash('sha256').update(JSON.stringify(tables)).digest('hex');
}

function createBackup({ stateDir, localGet, upload, getAccount, now = () => Date.now(), interval = BACKUP_INTERVAL }) {
  const stateFile = path.join(stateDir, 'backup-state.json');
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
  let running = null;
  let controller = null;
  let generation = 0;

  async function run(reason, signal) {
    const account = getAccount();
    if (!account) return { result: 'signed-out' };
    const isCurrent = () => !signal.aborted && getAccount()?.userId === account.userId;
    const writeState = (patch) => {
      if (!isCurrent()) return;
      const previous = readState();
      fs.writeFileSync(stateFile, JSON.stringify({ ...(previous.userId === account.userId ? previous : {}), userId: account.userId, ...patch }));
    };
    const bounded = (operation) => Promise.race([
      operation,
      new Promise((resolve, reject) => {
        if (signal.aborted) reject(new Error('Backup cancelled'));
        else signal.addEventListener('abort', () => reject(new Error('Backup cancelled')), { once: true });
      }),
    ]);
    const state = readState();
    // The state belongs to one account: another account's last hash says nothing about this one.
    const mine = state.userId === account.userId ? state : {};
    // Told by the server it was at today's limit: do not ask again until it said it would allow another.
    if (mine.blockedUntil && mine.blockedUntil > now()) return { result: 'daily-limit', retryAt: mine.blockedUntil };

    let snapshot;
    try { snapshot = JSON.parse((await bounded(localGet('/api/backup', { accountIdentity: account.userId, signal }))).toString('utf8')); }
    catch { if (!isCurrent()) return { result: 'cancelled' }; writeState({ lastAttemptAt: now(), lastResult: 'local-error' }); return { result: 'local-error' }; }
    if (!isCurrent()) return { result: 'cancelled' };
    const hash = contentHash(snapshot);
    if (mine.lastHash === hash && mine.lastSuccessAt) {
      writeState({ userId: account.userId, lastCheckedAt: now(), lastResult: 'unchanged' });
      return { result: 'unchanged' };
    }

    const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)));
    let reply;
    try { reply = await bounded(upload(bytes, hash, { accountIdentity: account.userId, signal })); }
    catch (error) {
      if (!isCurrent()) return { result: 'cancelled' };
      const result = error.code === 'account-mismatch' ? 'sign-in-needed' : 'offline';
      writeState({ userId: account.userId, lastAttemptAt: now(), lastResult: result });
      return { result };
    }
    if (!isCurrent()) return { result: 'cancelled' };

    if (reply.status === 429) {
      let retryAt = now() + ERROR_BACKOFF;
      try { const parsed = typeof reply.body === 'string' ? JSON.parse(reply.body) : reply.body; if (parsed && Number(parsed.retryAt) > now()) retryAt = Number(parsed.retryAt); } catch { /* keep the default wait */ }
      writeState({ userId: account.userId, lastAttemptAt: now(), lastResult: 'daily-limit', blockedUntil: retryAt });
      return { result: 'daily-limit', retryAt };
    }
    if (reply.status === 401) { writeState({ userId: account.userId, lastAttemptAt: now(), lastResult: 'sign-in-needed' }); return { result: 'sign-in-needed' }; }
    if (reply.status === 200 || reply.status === 201) {
      writeState({ userId: account.userId, lastHash: hash, lastSuccessAt: now(), lastAttemptAt: now(), lastResult: 'backed-up', lastReason: reason, blockedUntil: null, retryAfter: null });
      return { result: 'backed-up', stored: reply.status === 201 };
    }
    writeState({ userId: account.userId, lastAttemptAt: now(), lastResult: `error-${reply.status}`, retryAfter: now() + ERROR_BACKOFF });
    return { result: 'error', status: reply.status };
  }

  /** One backup at a time: asking while one is running gets that one's answer. */
  const backupNow = (reason = 'manual') => {
    if (!running) {
      controller = new AbortController();
      running = run(reason, controller.signal).finally(() => { running = null; controller = null; });
    }
    return running;
  };
  const cancel = async () => { generation += 1; controller?.abort(); await running; };
  const beforeSignOut = async () => {
    const started = generation;
    if (running) await running;
    if (started !== generation) return { result: 'cancelled' };
    return backupNow('sign-out');
  };

  /** Whether a scheduled backup is due: signed in, and the last good one is older than the interval (three days). */
  function due() {
    const account = getAccount();
    if (!account) return false;
    const state = readState();
    if (state.userId === account.userId && ((state.blockedUntil && state.blockedUntil > now()) || (state.retryAfter && state.retryAfter > now()))) return false;
    return state.userId !== account.userId || !state.lastSuccessAt || now() - state.lastSuccessAt >= interval;
  }

  function status() {
    const state = readState();
    const account = getAccount();
    return {
      lastSuccessAt: account && state.userId === account.userId ? state.lastSuccessAt || null : null,
      lastResult: account && state.userId === account.userId ? state.lastResult || null : null,
    };
  }

  /** The timer: look every 15 minutes whether a backup is due (cheap, local only), and back up when it is. */
  function startSchedule({ setTimer = setInterval, clearTimer = clearInterval, firstCheckMs = 60 * 1000, checkEveryMs = 15 * 60 * 1000 } = {}) {
    const tick = () => { if (due()) void backupNow('scheduled'); };
    const first = setTimeout(tick, firstCheckMs);
    const timer = setTimer(tick, checkEveryMs);
    return () => { clearTimeout(first); clearTimer(timer); };
  }

  return { backupNow, beforeSignOut, cancel, due, status, startSchedule, contentHash };
}

module.exports = { createBackup, contentHash, BACKUP_INTERVAL, ERROR_BACKOFF };
