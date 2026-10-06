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
const APP_ID = 'com.hitlist.desktop';
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // for sh

/** The .app folder the running Mac app lives in, or null (a dev run, or not inside a bundle). */
function macBundleOf(exePath) {
  const m = /^(.*?\.app)\/Contents\/MacOS\//.exec(exePath || '');
  return m ? m[1] : null;
}

/**
 * How this install can be replaced in place by us, or why it cannot. Anything else falls back to "download and open".
 *   { ok: true, mode: 'replace' }   Mac: the whole .app is swapped (needs a writable folder around it)
 *   { ok: true, mode: 'contents' }  Mac: the folder around the app is not ours (typical for /Applications on a standard account),
 *                                   but the app itself is, so what is inside it is swapped and the app keeps its place
 *   { ok: true, mode: 'installer' } Windows: the installer runs silently over the existing install
 *   { ok: true, mode: 'appimage' }  Linux: the AppImage file is replaced
 *   { ok: false, reason }           'dev-run' | 'disk-image' | 'translocated' | 'not-writable' | 'other-disk' | 'package-install' | 'unsupported'
 * `env` is injected for tests: { platform, exePath, appImage, isPackaged, access, sameDisk }.
 */
function swapPlan({ platform, exePath, appImage, isPackaged, access = (p) => fs.accessSync(p, fs.constants.W_OK), sameDisk = () => true }) {
  if (!isPackaged) return { ok: false, reason: 'dev-run' };
  const writable = (p) => { try { access(p); return true; } catch { return false; } };
  if (platform === 'darwin') {
    const bundle = macBundleOf(exePath);
    if (!bundle) return { ok: false, reason: 'dev-run' };
    // Opened from a disk image, or run from the temporary read-only copy macOS makes for a freshly downloaded app.
    if (bundle.startsWith('/Volumes/')) return { ok: false, reason: 'disk-image' };
    if (bundle.includes('/AppTranslocation/')) return { ok: false, reason: 'translocated' };
    if (!writable(bundle)) return { ok: false, reason: 'not-writable' };
    if (writable(path.dirname(bundle))) return { ok: true, mode: 'replace' };
    // The new files are prepared on this computer's data disk; moving them in must be a rename, never a slow copy.
    return sameDisk(bundle) ? { ok: true, mode: 'contents' } : { ok: false, reason: 'other-disk' };
  }
  if (platform === 'win32') return { ok: true, mode: 'installer' }; // the installer puts itself back in the same place
  if (platform === 'linux') {
    if (!appImage) return { ok: false, reason: 'package-install' };
    return writable(path.dirname(appImage)) && writable(appImage) ? { ok: true, mode: 'appimage' } : { ok: false, reason: 'not-writable' };
  }
  return { ok: false, reason: 'unsupported' };
}

/** Whether this install can be replaced in place by us (see swapPlan for how, or why not). */
function canSwap(env) {
  return swapPlan(env).ok;
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

/**
 * sh script for Mac when the folder around the app is not ours: wait for `pid` to exit, then swap what is INSIDE the app
 * (its Contents folder) and open it. The app keeps its name and place. The old Contents is kept in `keep` until the new app
 * has started (it is removed then, outside the app, so the app's seal is never left with extra files). On failure the old
 * Contents goes back.
 */
function macContentsScript({ pid, bundle, stagedContents, keep, open = 'open' }) {
  return `#!/bin/sh
PID=${Number(pid)}
BUNDLE=${quote(bundle)}
NEW=${quote(stagedContents)}
OLD=${quote(keep)}
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt ${WAIT_SECONDS * 2} ]; then echo "old app still running; not replacing it"; rm -rf "$NEW"; exit 1; fi
  sleep 0.5
done
rm -rf "$OLD"
if mv "$BUNDLE/Contents" "$OLD" && mv "$NEW" "$BUNDLE/Contents"; then
  xattr -dr com.apple.quarantine "$BUNDLE" 2>/dev/null
  ${open} "$BUNDLE"
else
  echo "swap failed; putting the old app back"
  if [ ! -d "$BUNDLE/Contents" ] && [ -d "$OLD" ]; then mv "$OLD" "$BUNDLE/Contents"; fi
  rm -rf "$NEW"
  ${open} "$BUNDLE"
  exit 1
fi
`;
}

/**
 * cmd script for Windows: wait for `pid` to exit, run the installer silently over the existing install, start the app.
 * The wait uses ping (not `timeout`, which refuses to run without a console) and matches the pid as a whole CSV field, so
 * another process whose numbers merely contain it does not hold the update back. The installer is run unattended; the app is
 * started here, because a silent NSIS install does not start it.
 */
function winScript({ pid, installer, app }) {
  const id = Number(pid);
  const batchPath = (value) => {
    if (/["\r\n]/.test(value)) throw new Error('Invalid update path');
    return value.replace(/%/g, '%%');
  };
  const destination = batchPath(path.win32.dirname(app)).replace(/[&|<>()^]/g, '^$&');
  return `@echo off
setlocal disabledelayedexpansion
setlocal enabledelayedexpansion
set n=0
:wait
tasklist /FI "PID eq ${id}" /FO CSV /NH 2>NUL | find """${id}""" >NUL
if not errorlevel 1 (
  set /a n+=1
  if !n! GTR ${WAIT_SECONDS} exit /b 1
  ping -n 2 127.0.0.1 >NUL
  goto wait
)
endlocal
start /wait "" "${batchPath(installer)}" /S /D=${destination}
if errorlevel 1 (
  start "" "${batchPath(app)}"
  exit /b 1
)
start "" "${batchPath(app)}"
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
# The new app starts clean: nothing from the old AppImage's mount is passed on.
unset APPDIR APPIMAGE ARGV0 OWD
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
      const plan = deps.plan || swapPlan({ platform, exePath, appImage, isPackaged: true, sameDisk: (p) => fs.statSync(p).dev === fs.statSync(helperDir).dev });
      if (!plan.ok) return { ok: false, reason: 'not-installed' };
      // 'replace' prepares the new app beside the old one; 'contents' prepares it in our own folder (the folder around the app is not ours).
      const stageParent = plan.mode === 'replace'
        ? fs.mkdtempSync(path.join(path.dirname(bundle), '.HitList-update-'))
        : fs.mkdtempSync(path.join(helperDir, 'stage-'));
      try {
        if (/\.dmg$/i.test(file)) {
          // A disk image the person downloaded: mount it read-only out of sight, copy the app out, and let go of the image.
          const mount = fs.mkdtempSync(path.join(helperDir, 'mount-'));
          try {
            run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file]);
            const inside = fs.readdirSync(mount).find((n) => n.endsWith('.app'));
            if (!inside) throw new Error('no-app-in-zip');
            run('ditto', [path.join(mount, inside), path.join(stageParent, inside)]);
          } finally {
            try { run('hdiutil', ['detach', mount, '-force']); } catch { /* it may never have attached */ }
            rm(mount);
          }
        } else {
          run('ditto', ['-x', '-k', file, stageParent]);
        }
        const app = fs.readdirSync(stageParent).find((n) => n.endsWith('.app'));
        if (!app) throw new Error('no-app-in-zip');
        // Only a HitList app is installed over HitList, whatever file was handed in.
        const id = String(run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(stageParent, app, 'Contents', 'Info.plist')]) || '').trim();
        if (id && id !== APP_ID) throw new Error('no-app-in-zip');
        run('codesign', ['--verify', '--deep', '--strict', path.join(stageParent, app)]);
        if (plan.mode === 'contents') {
          const script = path.join(helperDir, 'swap-contents.sh');
          fs.writeFileSync(script, macContentsScript({
            pid, bundle, stagedContents: path.join(stageParent, app, 'Contents'), keep: path.join(helperDir, 'Contents.old'),
          }), { mode: 0o700 });
          spawnDetached('/bin/sh', [script]);
          return { ok: true };
        }
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
function cleanupAfterUpdate({ platform, exePath, helperDir, rm = (p) => fs.rmSync(p, { recursive: true, force: true }), list = (d) => fs.readdirSync(d) }) {
  if (platform !== 'darwin') return;
  const bundle = macBundleOf(exePath);
  if (!bundle) return;
  const remove = (target) => { try { rm(target); } catch { /* cleanup must not prevent startup */ } };
  remove(`${bundle}.old`);
  if (helperDir) {
    remove(path.join(helperDir, 'Contents.old'));
    try { for (const name of list(helperDir)) if (name.startsWith('stage-') || name.startsWith('mount-')) remove(path.join(helperDir, name)); } catch { /* no folder yet */ }
  }
  const dir = path.dirname(bundle);
  try {
    for (const name of list(dir)) {
      if (name.startsWith('.HitList-update-') || name === `.${path.basename(bundle)}.new`) remove(path.join(dir, name));
    }
  } catch { /* the folder cannot be listed: nothing to clean */ }
}

module.exports = { canSwap, swapPlan, install, cleanupAfterUpdate, macBundleOf, macScript, macContentsScript, winScript, linuxScript };
