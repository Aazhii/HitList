/**
 * Restoring a backup (D4). Like backup.js, nothing here touches Electron or the network directly.
 *
 *   localGet(path) -> Buffer          localPost(path, body) -> { status, json }
 *   cloudList()    -> [{at,hash,size}]   cloudLatest() -> Buffer (the gzip bytes)
 *   getAccount()   -> { userId } | null
 *   lastBackupAt() -> ms | null       when this account last backed up from here
 *
 * The cloud is asked only when it can matter: at sign-in, when the local workspace is empty, or when the person asks.
 * A normal launch with data in the app makes no cloud call. Restoring only ever adds (the local server's import skips
 * any row that already exists), so it can never overwrite or delete anything on this machine.
 */
const zlib = require('node:zlib');
const { contentHash } = require('./backup');

/** Nothing the person made: no tasks, notes or databases. (Default lists do not count.) */
function isEmptyWorkspace(snapshot) {
  const t = (snapshot && snapshot.tables) || {};
  return ['KaizenTasks', 'KaizenNotes', 'KaizenDatabases'].every((name) => !(t[name] && t[name].length));
}

function createRestore({ getAccount, localGet, localPost, cloudList, cloudLatest, lastBackupAt }) {
  /**
   * What, if anything, to offer. `justSignedIn` and `force` allow a cloud call even when the workspace has data.
   * States: signed-out, skipped, none, in-sync, restore-available (empty install), newer-elsewhere, local-is-newer, offline.
   */
  async function check({ justSignedIn = false, force = false } = {}) {
    const account = getAccount();
    if (!account) return { state: 'signed-out' };
    let local;
    try { local = JSON.parse((await localGet('/api/backup', { accountIdentity: account.userId })).toString('utf8')); }
    catch { return { state: 'local-error' }; }
    if (getAccount()?.userId !== account.userId) return { state: 'signed-out' };
    const empty = isEmptyWorkspace(local);
    if (!empty && !justSignedIn && !force) return { state: 'skipped' };

    let list;
    try { list = await cloudList(); } catch { return { state: 'offline' }; }
    if (getAccount()?.userId !== account.userId) return { state: 'signed-out' };
    if (!list || list.length === 0) return { state: 'none' };
    const latest = list[0];
    if (latest.hash === contentHash(local)) return { state: 'in-sync' };
    if (empty) return { state: 'restore-available', at: latest.at, backups: list.length };
    const mine = lastBackupAt();
    if (mine && latest.at <= mine) return { state: 'local-is-newer' };
    return { state: 'newer-elsewhere', at: latest.at, backups: list.length };
  }

  /** Downloads the newest backup and adds what is missing to this machine. */
  async function restore() {
    const account = getAccount();
    if (!account) return { result: 'signed-out' };
    let bytes;
    try { bytes = await cloudLatest(); } catch { return { result: 'offline' }; }
    if (getAccount()?.userId !== account.userId) return { result: 'signed-out' };
    if (!bytes) return { result: 'none' };
    let snapshot;
    try { snapshot = JSON.parse(zlib.gunzipSync(bytes).toString('utf8')); }
    catch { return { result: 'damaged' }; }
    const reply = await localPost('/api/backup', snapshot, { accountIdentity: account.userId });
    if (reply.status !== 200) return { result: 'local-error', status: reply.status };
    return { result: 'restored', imported: reply.json.imported || {}, skipped: reply.json.skipped || {} };
  }

  return { check, restore };
}

module.exports = { createRestore, isEmptyWorkspace };
