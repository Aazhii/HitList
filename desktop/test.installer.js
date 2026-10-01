const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { canSwap, install, cleanupAfterUpdate, macBundleOf, macScript, winScript, linuxScript } = require('./installer');

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
  assert.match(linuxScript({ pid: 4242, appImage: '/h/HitList.AppImage', staged: '/h/.HitList.AppImage.new' }), /kill -0[\s\S]*chmod \+x[\s\S]*mv -f/);
});

test('paths with quotes cannot break out of the script', () => {
  const text = macScript({ pid: 1, bundle: "/Users/o'brien/HitList.app", staged: '/x/.new' });
  assert.ok(text.includes(`'/Users/o'\\''brien/HitList.app'`));
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
  assert.deepStrictEqual(ran, ['ditto', 'codesign']);
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
