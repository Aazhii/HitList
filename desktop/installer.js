/**
 * Replaces the installed app with a downloaded, verified update, then starts it again.
 *
 * The running app cannot replace itself, so a small helper script does the swap after this process has exited:
 * it waits for our process id to disappear, moves the new app in, and opens it. If anything goes wrong it puts the
 * old app back and opens that. The tasks live in the data folder, which none of this touches.
 *
 * Mac swaps the whole .app bundle, Windows runs the installer silently, Linux replaces the AppImage file. The script
 * builders are pure (they return text) so they can be tested; `launch` is the only part that starts a process.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const WAIT_SECONDS = 60;
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // for sh

/** The .app folder the running Mac app lives in, or null (a dev run, or not inside a bundle). */
function macBundleOf(exePath) {
  const m = /^(.*?\.app)\/Contents\/MacOS\//.exec(exePath || '');
  return m ? m[1] : null;
}

/**
 * Whether this install can be replaced in place by us. Anything else falls back to "download and open".
 * `env` is injected for tests: { platform, exePath, appImage, isPackaged, access }.
 */
function canSwap({ platform, exePath, appImage, isPackaged, access = (p) => fs.accessSync(p, fs.constants.W_OK) }) {
  if (!isPackaged) return false;
  const writable = (p) => { try { access(p); return true; } catch { return false; } };
  if (platform === 'darwin') {
    const bundle = macBundleOf(exePath);
    if (!bundle) return false;
    // Opened from a disk image, or run from the temporary read-only copy macOS makes for a freshly downloaded app.
    if (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return false;
    return writable(path.dirname(bundle)) && writable(bundle);
  }
  if (platform === 'win32') return true; // the installer puts itself back in the same place
  if (platform === 'linux') return !!appImage && writable(path.dirname(appImage)) && writable(appImage);
  return false;
}

/** sh script for Mac: wait for `pid` to exit, swap the bundle, open it. On failure restore the old one. */
function macScript({ pid, bundle, staged, open = 'open' }) {
  const old = `${bundle}.old`;
  return `#!/bin/sh
PID=${Number(pid)}
BUNDLE=${quote(bundle)}
STAGED=${quote(staged)}
OLD=${quote(old)}
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt ${WAIT_SECONDS * 2} ]; then echo "old app still running; not replacing it"; rm -rf "$STAGED"; exit 1; fi
  sleep 0.5
done
rm -rf "$OLD"
if mv "$BUNDLE" "$OLD" && mv "$STAGED" "$BUNDLE"; then
  xattr -dr com.apple.quarantine "$BUNDLE" 2>/dev/null
  ${open} "$BUNDLE"
else
  echo "swap failed; putting the old app back"
  if [ ! -d "$BUNDLE" ] && [ -d "$OLD" ]; then mv "$OLD" "$BUNDLE"; fi
  rm -rf "$STAGED"
  ${open} "$BUNDLE"
  exit 1
fi
`;
}

/** cmd script for Windows: wait for `pid`, run the installer silently, start the app. */
function winScript({ pid, installer, app }) {
  return `@echo off
set /a n=0
:wait
tasklist /FI "PID eq ${Number(pid)}" 2>NUL | find "${Number(pid)}" >NUL
if not errorlevel 1 (
  set /a n+=1
  if %n% GTR ${WAIT_SECONDS} exit /b 1
  timeout /t 1 /nobreak >NUL
  goto wait
)
start /wait "" "${installer}" /S
start "" "${app}"
`;
}

/** sh script for Linux: wait for `pid`, replace the AppImage file, start it. */
function linuxScript({ pid, appImage, staged }) {
  return `#!/bin/sh
PID=${Number(pid)}
TARGET=${quote(appImage)}
STAGED=${quote(staged)}
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt ${WAIT_SECONDS * 2} ]; then rm -f "$STAGED"; exit 1; fi
  sleep 0.5
done
chmod +x "$STAGED"
if mv -f "$STAGED" "$TARGET"; then
  nohup "$TARGET" >/dev/null 2>&1 &
else
  rm -f "$STAGED"
  nohup "$TARGET" >/dev/null 2>&1 &
  exit 1
fi
`;
}

/**
 * Gets the downloaded file ready (Mac: unpack and check the new app's signature) and starts the helper.
 * Resolves { ok: true } when the helper is running and the caller should now quit, or { ok: false, reason }.
 * `deps` is injected for tests: { run, spawnDetached, writeFile, mkdtemp, rm, exists, rename, copy }.
 */
async function install({ platform, file, exePath, appImage, pid, helperDir, deps = {} }) {
  const run = deps.run || ((cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }));
  const spawnDetached = deps.spawnDetached || ((cmd, args) => { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); });
  const rm = deps.rm || ((p) => fs.rmSync(p, { recursive: true, force: true }));
  fs.mkdirSync(helperDir, { recursive: true });
  try {
    if (platform === 'darwin') {
      const bundle = macBundleOf(exePath);
      if (!bundle) return { ok: false, reason: 'not-installed' };
      // Unpack next to the app so the final move stays on one disk and is instant.
      const stageParent = fs.mkdtempSync(path.join(path.dirname(bundle), '.HitList-update-'));
      try {
        run('ditto', ['-x', '-k', file, stageParent]);
        const app = fs.readdirSync(stageParent).find((n) => n.endsWith('.app'));
        if (!app) throw new Error('no-app-in-zip');
        run('codesign', ['--verify', '--deep', '--strict', path.join(stageParent, app)]);
        const staged = path.join(path.dirname(bundle), `.${path.basename(bundle)}.new`);
        rm(staged);
        fs.renameSync(path.join(stageParent, app), staged);
        rm(stageParent);
        const script = path.join(helperDir, 'swap.sh');
        fs.writeFileSync(script, macScript({ pid, bundle, staged }), { mode: 0o700 });
        spawnDetached('/bin/sh', [script]);
        return { ok: true };
      } catch (e) {
        rm(stageParent);
        return { ok: false, reason: e && e.message === 'no-app-in-zip' ? 'bad-package' : 'unpack-failed' };
      }
    }
    if (platform === 'win32') {
      const script = path.join(helperDir, 'swap.cmd');
      fs.writeFileSync(script, winScript({ pid, installer: file, app: exePath }));
      spawnDetached('cmd.exe', ['/c', script]);
      return { ok: true };
    }
    if (platform === 'linux') {
      if (!appImage) return { ok: false, reason: 'not-installed' };
      const staged = path.join(path.dirname(appImage), `.${path.basename(appImage)}.new`);
      fs.copyFileSync(file, staged);
      const script = path.join(helperDir, 'swap.sh');
      fs.writeFileSync(script, linuxScript({ pid, appImage, staged }), { mode: 0o700 });
      spawnDetached('/bin/sh', [script]);
      return { ok: true };
    }
    return { ok: false, reason: 'unsupported' };
  } catch {
    return { ok: false, reason: 'install-failed' };
  }
}

/** After a successful start: remove what an earlier update left beside the app (the old copy, unpack folders). */
function cleanupAfterUpdate({ platform, exePath, rm = (p) => fs.rmSync(p, { recursive: true, force: true }), list = (d) => fs.readdirSync(d) }) {
  if (platform !== 'darwin') return;
  const bundle = macBundleOf(exePath);
  if (!bundle) return;
  rm(`${bundle}.old`);
  const dir = path.dirname(bundle);
  try {
    for (const name of list(dir)) {
      if (name.startsWith('.HitList-update-') || name === `.${path.basename(bundle)}.new`) rm(path.join(dir, name));
    }
  } catch { /* the folder cannot be listed: nothing to clean */ }
}

module.exports = { canSwap, install, cleanupAfterUpdate, macBundleOf, macScript, winScript, linuxScript };
