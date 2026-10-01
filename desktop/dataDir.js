/**
 * Where the app keeps its data, and the one-time copy from the folder older runs used.
 *
 * Running from the project (`pnpm start`) used ~/Library/Application Support/hitlist-desktop, while an installed
 * HitList.app uses .../HitList, so the installed app opened empty. Both now use the HitList folder. Moving into it is a
 * COPY, never a move, and only when the new folder has no database yet, so nothing is overwritten and the old folder is
 * left exactly as it was.
 */
const fs = require('node:fs');
const path = require('node:path');

const DATA_FOLDER = 'HitList';
const LEGACY_FOLDER = 'hitlist-desktop';
/** Everything the app keeps. The database comes with its write-ahead files if it has any. */
const FILES = ['hitlist.db', 'hitlist.db-wal', 'hitlist.db-shm', 'owner-secret.txt', 'account.json', 'backup-state.json'];

const dataDirIn = (appDataDir) => path.join(appDataDir, DATA_FOLDER);

/**
 * Copies the legacy folder's data into `dir` if `dir` has no database and the legacy folder does.
 * Returns what happened: 'copied', 'already-there', 'nothing-to-copy'.
 */
function migrateLegacyData({ legacyDir, dir }) {
  if (fs.existsSync(path.join(dir, 'hitlist.db'))) return 'already-there';
  if (!fs.existsSync(path.join(legacyDir, 'hitlist.db'))) return 'nothing-to-copy';
  fs.mkdirSync(dir, { recursive: true });
  // The secret and the database belong together: a database without its secret cannot be opened as the same owner.
  for (const name of FILES) {
    const from = path.join(legacyDir, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name), fs.constants.COPYFILE_EXCL);
  }
  return 'copied';
}

module.exports = { dataDirIn, migrateLegacyData, DATA_FOLDER, LEGACY_FOLDER, FILES };
