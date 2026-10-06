const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { canSwap, swapPlan, install, cleanupAfterUpdate, macBundleOf, macScript, macContentsScript, winScript, linuxScript } = require('./installer');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
const fakeApp = (dir, name, marker) => {
  const app = path.join(dir, name);
  fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'marker'), marker);
  return app;
};
const marker = (app) => fs.readFileSync(path.join(app, 'Contents', 'marker'), 'utf8');

test('finds the app bundle from the running executable', () => {
  assert.strictEqual(macBundleOf('/Applications/HitList.app/Contents/MacOS/HitList'), '/Applications/HitList.app');
  assert.strictEqual(macBundleOf('/usr/local/bin/electron'), null);
});

test('inaccessible update leftovers do not prevent startup or cleanup of other files', () => {
  const attempted = [];
  const removed = [];
  const denied = new Set(['/Applications/HitList.app.old', '/updates/Contents.old', '/updates/stage-denied', '/Applications/.HitList-update-denied']);
  assert.doesNotThrow(() => cleanupAfterUpdate({
    platform: 'darwin', exePath: '/Applications/HitList.app/Contents/MacOS/HitList', helperDir: '/updates',
    list: (dir) => dir === '/updates' ? ['stage-denied', 'stage-ok', 'keep'] : ['.HitList-update-denied', '.HitList.app.new', 'HitList.app'],
    rm: (target) => {
      attempted.push(target);
      if (denied.has(target)) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      removed.push(target);
    },
  }));
  assert.deepStrictEqual(removed, ['/updates/stage-ok', '/Applications/.HitList.app.new']);
  assert.strictEqual(attempted.length, 6);
  assert.ok(!attempted.includes('/Applications/HitList.app'));
});

test('one-click replacing is only offered where it can work', () => {
  const ok = () => {};
  const no = () => { throw new Error('EACCES'); };
  const exe = '/Applications/HitList.app/Contents/MacOS/HitList';
  assert.strictEqual(canSwap({ platform: 'darwin', exePath: exe, isPackaged: true, access: ok }), true);
  assert.strictEqual(canSwap({ platform: 'darwin', exePath: exe, isPackaged: true, access: no }), false, 'folder not writable');
  assert.strictEqual(canSwap({ platform: 'darwin', exePath: exe, isPackaged: false, access: ok }), false, 'development run');
  assert.strictEqual(canSwap({ platform: 'darwin', exePath: '/Volumes/HitList/HitList.app/Contents/MacOS/HitList', isPackaged: true, access: ok }), false, 'opened from the disk image');
  assert.strictEqual(canSwap({ platform: 'darwin', exePath: '/private/var/folders/x/AppTranslocation/ABC/d/HitList.app/Contents/MacOS/HitList', isPackaged: true, access: ok }), false, 'translocated');
  assert.strictEqual(canSwap({ platform: 'linux', appImage: '/home/u/HitList.AppImage', isPackaged: true, access: ok }), true);
  assert.strictEqual(canSwap({ platform: 'linux', appImage: undefined, isPackaged: true, access: ok }), false, 'a .deb install');
  assert.strictEqual(canSwap({ platform: 'win32', exePath: 'C:\\x\\HitList.exe', isPackaged: true, access: ok }), true);
});

test('the Mac helper really swaps the app, opens it, and keeps the old copy for the new app to delete', () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const staged = fakeApp(dir, '.HitList.app.new', 'new');
  const opened = path.join(dir, 'opened.txt');
  const open = path.join(dir, 'fake-open.sh');
  fs.writeFileSync(open, `#!/bin/sh\necho "$1" > ${JSON.stringify(opened)}\n`, { mode: 0o755 });
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, macScript({ pid: 99999999, bundle, staged, open }));
  execFileSync('/bin/sh', [script]);
  assert.strictEqual(marker(bundle), 'new');
  assert.strictEqual(marker(`${bundle}.old`), 'old');
  assert.ok(!fs.existsSync(staged));
  assert.strictEqual(fs.readFileSync(opened, 'utf8').trim(), bundle);
  cleanupAfterUpdate({ platform: 'darwin', exePath: path.join(bundle, 'Contents/MacOS/HitList') });
  assert.ok(!fs.existsSync(`${bundle}.old`));
});

test('if the new app cannot be moved in, the old one is put back and opened', () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const missingStaged = path.join(dir, '.HitList.app.new'); // never created: the second move fails
  const opened = path.join(dir, 'opened.txt');
  const open = path.join(dir, 'fake-open.sh');
  fs.writeFileSync(open, `#!/bin/sh\necho "$1" > ${JSON.stringify(opened)}\n`, { mode: 0o755 });
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, macScript({ pid: 99999999, bundle, staged: missingStaged, open }));
  try { execFileSync('/bin/sh', [script], { stdio: 'pipe' }); } catch { /* exits 1 on purpose */ }
  assert.strictEqual(marker(bundle), 'old');
  assert.ok(!fs.existsSync(`${bundle}.old`));
  assert.strictEqual(fs.readFileSync(opened, 'utf8').trim(), bundle);
});

test('the helper waits for the running app to exit before touching anything', () => {
  const text = macScript({ pid: 4242, bundle: '/Applications/HitList.app', staged: '/Applications/.HitList.app.new' });
  assert.ok(text.indexOf('kill -0') < text.indexOf('mv "$BUNDLE"'));
  assert.match(winScript({ pid: 4242, installer: 'C:\\u\\Setup.exe', app: 'C:\\a\\HitList.exe' }), /tasklist[^\n]*4242[\s\S]*Setup\.exe" \/S[\s\S]*start "" "C:\\a\\HitList\.exe"/);
  const w = winScript({ pid: 4242, installer: 'C:\\u\\Setup.exe', app: 'C:\\a\\HitList.exe' });
  assert.match(w, /enabledelayedexpansion/);
  assert.match(w, /if !n! GTR 60/, 'the wait limit is read at run time, not frozen when the block is parsed');
  assert.match(w, /ping -n 2/);
  assert.doesNotMatch(w, /timeout \/t/);
  assert.match(w, /\/FO CSV/);
  assert.match(linuxScript({ pid: 4242, appImage: '/h/HitList.AppImage', staged: '/h/.HitList.AppImage.new' }), /kill -0[\s\S]*chmod \+x[\s\S]*mv -f/);
});

test('paths with quotes cannot break out of the script', () => {
  const text = macScript({ pid: 1, bundle: "/Users/o'brien/HitList.app", staged: '/x/.new' });
  assert.ok(text.includes(`'/Users/o'\\''brien/HitList.app'`));
});

test('Windows update paths preserve exclamation marks and the custom install directory', () => {
  const script = winScript({ pid: 4242, installer: 'C:\\Users\\A! B\\Setup.exe', app: 'D:\\Apps & tools\\HitList!\\HitList.exe' });
  assert.ok(script.startsWith('@echo off\nsetlocal disabledelayedexpansion\n'));
  assert.ok(script.indexOf('endlocal') < script.indexOf('start /wait'));
  assert.ok(script.includes('"C:\\Users\\A! B\\Setup.exe" /S /D=D:\\Apps ^& tools\\HitList!'));
  assert.match(script, /if errorlevel 1/);
  assert.ok(winScript({ pid: 1, installer: 'C:\\100%\\Setup.exe', app: 'C:\\HitList\\HitList.exe' }).includes('100%%'));
  assert.throws(() => winScript({ pid: 1, installer: 'bad"path', app: 'C:\\HitList.exe' }), /Invalid update path/);
});

test('install on Mac unpacks beside the app, checks the signature, and starts the helper', async () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const exe = path.join(bundle, 'Contents/MacOS/HitList');
  const ran = [];
  let started = null;
  const out = await install({
    platform: 'darwin', file: '/dl/HitList-1.2.0-arm64.zip', exePath: exe, pid: 7, helperDir: path.join(dir, 'helper'),
    deps: {
      run: (cmd, args) => {
        ran.push(cmd);
        if (cmd === 'ditto') fakeApp(args[3], 'HitList.app', 'new');
      },
      spawnDetached: (cmd, args) => { started = [cmd, ...args]; },
    },
  });
  assert.deepStrictEqual(out, { ok: true });
  assert.deepStrictEqual(ran, ['ditto', 'plutil', 'codesign']);
  assert.ok(fs.existsSync(path.join(dir, '.HitList.app.new')));
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.HitList-update-')), []);
  assert.strictEqual(started[0], '/bin/sh');
  assert.strictEqual(marker(bundle), 'old', 'the running app is untouched until the helper runs');
});

test('install refuses and cleans up when the signature check or the package is bad', async () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const exe = path.join(bundle, 'Contents/MacOS/HitList');
  let spawned = false;
  const base = { platform: 'darwin', file: '/dl/x.zip', exePath: exe, pid: 7, helperDir: path.join(dir, 'helper') };
  const badSig = await install({ ...base, deps: { run: (cmd, args) => { if (cmd === 'ditto') fakeApp(args[3], 'HitList.app', 'new'); else throw new Error('invalid signature'); }, spawnDetached: () => { spawned = true; } } });
  assert.strictEqual(badSig.ok, false);
  const empty = await install({ ...base, deps: { run: () => {}, spawnDetached: () => { spawned = true; } } });
  assert.deepStrictEqual(empty, { ok: false, reason: 'bad-package' });
  assert.strictEqual(spawned, false);
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.HitList')), []);
  assert.strictEqual(marker(bundle), 'old');
});

const mac = (extra = {}) => ({ platform: 'darwin', exePath: '/Applications/HitList.app/Contents/MacOS/HitList', isPackaged: true, ...extra });

test('a Mac where only the app itself is ours (a standard account in /Applications) swaps what is inside the app', () => {
  const onlyBundle = (p) => { if (p === '/Applications') throw new Error('EACCES'); };
  assert.deepEqual(swapPlan(mac({ access: onlyBundle })), { ok: true, mode: 'contents' });
  assert.deepEqual(swapPlan(mac({ access: () => {} })), { ok: true, mode: 'replace' });
  assert.deepEqual(swapPlan(mac({ access: onlyBundle, sameDisk: () => false })), { ok: false, reason: 'other-disk' });
  assert.deepEqual(swapPlan(mac({ access: () => { throw new Error('EACCES'); } })), { ok: false, reason: 'not-writable' });
  assert.strictEqual(canSwap(mac({ access: onlyBundle })), true);
});

test('every reason the app cannot replace itself is named', () => {
  const ok = () => {};
  assert.deepEqual(swapPlan({ ...mac(), isPackaged: false, access: ok }), { ok: false, reason: 'dev-run' });
  assert.deepEqual(swapPlan(mac({ exePath: '/Volumes/HitList/HitList.app/Contents/MacOS/HitList', access: ok })), { ok: false, reason: 'disk-image' });
  assert.deepEqual(swapPlan(mac({ exePath: '/private/var/x/AppTranslocation/A/d/HitList.app/Contents/MacOS/HitList', access: ok })), { ok: false, reason: 'translocated' });
  assert.deepEqual(swapPlan({ platform: 'linux', isPackaged: true, access: ok }), { ok: false, reason: 'package-install' });
  assert.deepEqual(swapPlan({ platform: 'linux', appImage: '/h/HitList.AppImage', isPackaged: true, access: ok }), { ok: true, mode: 'appimage' });
  assert.deepEqual(swapPlan({ platform: 'win32', exePath: 'C:\\a\\HitList.exe', isPackaged: true, access: ok }), { ok: true, mode: 'installer' });
});

test('the contents helper really swaps what is inside the app, keeps the app\'s place, and the old contents go aside', () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const stage = path.join(dir, 'stage-1');
  fs.mkdirSync(stage);
  const newApp = fakeApp(stage, 'HitList.app', 'new');
  const keep = path.join(dir, 'Contents.old');
  const opened = path.join(dir, 'opened.txt');
  const open = path.join(dir, 'fake-open.sh');
  fs.writeFileSync(open, `#!/bin/sh\necho "$1" > ${JSON.stringify(opened)}\n`, { mode: 0o755 });
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, macContentsScript({ pid: 99999999, bundle, stagedContents: path.join(newApp, 'Contents'), keep, open }));
  execFileSync('/bin/sh', [script]);
  assert.strictEqual(marker(bundle), 'new');
  assert.strictEqual(fs.readFileSync(path.join(keep, 'marker'), 'utf8'), 'old');
  assert.deepStrictEqual(fs.readdirSync(bundle), ['Contents'], 'nothing extra is left inside the app');
  assert.strictEqual(fs.readFileSync(opened, 'utf8').trim(), bundle);
  cleanupAfterUpdate({ platform: 'darwin', exePath: path.join(bundle, 'Contents/MacOS/HitList'), helperDir: dir });
  assert.ok(!fs.existsSync(keep));
  assert.ok(!fs.existsSync(stage));
});

test('if the new contents cannot be moved in, the old ones are put back and the app opens', () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const opened = path.join(dir, 'opened.txt');
  const open = path.join(dir, 'fake-open.sh');
  fs.writeFileSync(open, `#!/bin/sh\necho "$1" > ${JSON.stringify(opened)}\n`, { mode: 0o755 });
  const script = path.join(dir, 'swap.sh');
  fs.writeFileSync(script, macContentsScript({ pid: 99999999, bundle, stagedContents: path.join(dir, 'missing', 'Contents'), keep: path.join(dir, 'Contents.old'), open }));
  try { execFileSync('/bin/sh', [script], { stdio: 'pipe' }); } catch { /* exits 1 on purpose */ }
  assert.strictEqual(marker(bundle), 'old');
  assert.ok(!fs.existsSync(path.join(dir, 'Contents.old')));
  assert.strictEqual(fs.readFileSync(opened, 'utf8').trim(), bundle);
});

test('install on a Mac whose Applications folder is not ours prepares the new contents in our own folder', async () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const exe = path.join(bundle, 'Contents/MacOS/HitList');
  const helper = path.join(dir, 'helper');
  let started = null;
  const out = await install({
    platform: 'darwin', file: '/dl/x.zip', exePath: exe, pid: 7, helperDir: helper,
    deps: {
      plan: { ok: true, mode: 'contents' },
      run: (cmd, args) => { if (cmd === 'ditto') fakeApp(args[3], 'HitList.app', 'new'); },
      spawnDetached: (cmd, args) => { started = [cmd, ...args]; },
    },
  });
  assert.deepStrictEqual(out, { ok: true });
  assert.ok(started[1].endsWith('swap-contents.sh'));
  assert.ok(fs.readdirSync(helper).some((n) => n.startsWith('stage-')), 'unpacked under our own folder');
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.HitList')), [], 'nothing was made beside the app');
  assert.strictEqual(marker(bundle), 'old', 'the running app is untouched until the helper runs');
});

test('a disk image is mounted out of sight, the app copied out, the image let go, and only a HitList app is accepted', async () => {
  const dir = tmp();
  const bundle = fakeApp(dir, 'HitList.app', 'old');
  const exe = path.join(bundle, 'Contents/MacOS/HitList');
  const ran = [];
  let started = null;
  const plutil = (id) => (cmd) => (cmd === 'plutil' ? Buffer.from(`${id}\n`) : undefined);
  const make = (id) => ({
    plan: { ok: true, mode: 'contents' },
    run: (cmd, args) => {
      ran.push(cmd);
      if (cmd === 'hdiutil' && args[0] === 'attach') fakeApp(args[args.indexOf('-mountpoint') + 1], 'HitList.app', 'new');
      if (cmd === 'ditto') fakeApp(args[1].replace(/\/[^/]+$/, '').replace(/\/HitList.app$/, ''), 'HitList.app', 'new');
      return plutil(id)(cmd);
    },
    spawnDetached: (cmd, args) => { started = [cmd, ...args]; },
  });
  const ok = await install({ platform: 'darwin', file: '/dl/HitList-1.1.27-arm64.dmg', exePath: exe, pid: 7, helperDir: path.join(dir, 'helper'), deps: make('com.hitlist.desktop') });
  assert.deepStrictEqual(ok, { ok: true });
  assert.deepStrictEqual(ran.filter((c) => c === 'hdiutil'), ['hdiutil', 'hdiutil'], 'attached, then detached');
  assert.ok(ran.indexOf('ditto') > ran.indexOf('hdiutil') && ran.includes('plutil') && ran.includes('codesign'));
  assert.ok(started[1].endsWith('swap-contents.sh'));
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'helper')).filter((n) => n.startsWith('mount-')), [], 'the mount point is gone');

  const other = await install({ platform: 'darwin', file: '/dl/HitList-1.1.27-arm64.dmg', exePath: exe, pid: 7, helperDir: path.join(dir, 'helper2'), deps: make('com.someone.else') });
  assert.deepStrictEqual(other, { ok: false, reason: 'bad-package' });
  assert.strictEqual(marker(bundle), 'old');
});
