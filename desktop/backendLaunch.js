'use strict';

const path = require('node:path');

/**
 * How the Java backend is launched, apart from main.js so it can be tested without Electron.
 *
 * Why the SQLite library needs care: the database driver ships its native library inside its jar and, on first use,
 * unpacks it into the system temporary folder and loads it from there. Where that folder is mounted `noexec`
 * (a common hardening setting on Linux) the system refuses to load it and the backend never starts. So the library is
 * shipped beside the app, where the installer put it, and the driver is told to load it from there; and the folders the
 * driver and Java would otherwise use in /tmp are moved into the app's own data folder.
 */

/** The file the driver looks for, per platform. Only Linux ships one beside the app today (see electron-builder.yml). */
const NATIVE_FILE = { linux: 'libsqlitejdbc.so' };

/** Our own temporary folder, made private to the person running the app. Null when it cannot be made. */
function privateTempDir({ fs, userDataDir }) {
  const dir = path.join(userDataDir, 'tmp');
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  } catch {
    return null;
  }
}

/**
 * The JVM options that go before `-jar`.
 *  - `--enable-native-access=ALL-UNNAMED` : the driver loads native code; Java warns about that today and will refuse it later.
 *  - the SQLite library from beside the app, when it is there (it is not in a development checkout);
 *  - temporary folders inside the app's data folder, the fallback if the bundled library is somehow missing.
 */
function jvmArgs({ fs, platform, resourcesPath, userDataDir }) {
  const args = ['--enable-native-access=ALL-UNNAMED'];

  const file = NATIVE_FILE[platform];
  if (file && resourcesPath) {
    const dir = path.join(resourcesPath, 'native');
    if (fs.existsSync(path.join(dir, file))) args.push(`-Dorg.sqlite.lib.path=${dir}`, `-Dorg.sqlite.lib.name=${file}`);
  }

  const tmp = privateTempDir({ fs, userDataDir });
  if (tmp) args.push(`-Djava.io.tmpdir=${tmp}`, `-Dorg.sqlite.tmpdir=${tmp}`);
  return args;
}

/**
 * What to tell the person when the backend stops while starting. `log` is what it printed; `logPath` is where the
 * whole of it was saved, because the dialog can only carry a line or two.
 */
function failureReason({ log, code, logPath }) {
  const where = logPath ? ` The full log is at ${logPath}.` : '';
  if (/UnsatisfiedLinkError|NativeLibraryNotFound|libsqlitejdbc|No native library found/i.test(log)) {
    return 'HitList could not load its local database library. This usually means the temporary folder of this system '
      + `does not allow running programs.${where}`;
  }
  // The last "Caused by" is the root of a Java stack trace; failing that, the last line that says ERROR.
  const lines = log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const cause = [...lines].reverse().find((line) => /^Caused by:/.test(line)) || [...lines].reverse().find((line) => /\bERROR\b/.test(line));
  const detail = cause ? ` ${cause.slice(0, 240)}` : '';
  return `The local backend stopped while starting (exit code ${code}).${detail}${where}`;
}

module.exports = { jvmArgs, failureReason, privateTempDir, NATIVE_FILE };
