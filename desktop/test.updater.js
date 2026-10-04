const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUpdater, parseVersion, compareVersions, pickAsset, hashFor } = require('./updater');

const v = (t) => parseVersion(t);

test('versions parse from plain numbers and release tags', () => {
  assert.deepStrictEqual(v('1.2.5').nums, [1, 2, 5]);
  assert.deepStrictEqual(v('HitList_1.2.5-beta2'), { nums: [1, 2, 5], stage: 'beta', stageNo: 2 });
  assert.ok(v('v2.0.0'));
  assert.strictEqual(v('1.2'), null);
  assert.strictEqual(v('1.2.0-gamma1'), null);
});

test('ordering: numbers, then alpha < beta < release', () => {
  assert.ok(compareVersions(v('1.10.0'), v('1.9.9')) > 0);
  assert.ok(compareVersions(v('1.2.5'), v('1.2.5-beta3')) > 0);
  assert.ok(compareVersions(v('1.2.5-beta1'), v('1.2.5-alpha9')) > 0);
  assert.ok(compareVersions(v('1.2.5-beta2'), v('1.2.5-beta10')) < 0);
  assert.strictEqual(compareVersions(v('1.2.5'), v('1.2.5')), 0);
});

const assetsOf = (ver) => [
  { name: `HitList-${ver}-arm64.dmg`, size: 5, browser_download_url: 'u/dmg' },
  { name: `HitList-${ver}-arm64.zip`, size: 5, browser_download_url: 'u/zip' },
  { name: `HitList-Setup-${ver}-x64.exe`, size: 5, browser_download_url: 'u/exe' },
  { name: `HitList-${ver}-x64.AppImage`, size: 5, browser_download_url: 'u/ai' },
  { name: `HitList_${ver}_amd64.deb`, size: 5, browser_download_url: 'u/deb' },
  { name: 'SHA256SUMS.txt', size: 1, browser_download_url: 'u/sums' },
];

test('the right installer per computer', () => {
  const a = assetsOf('1.2.5');
  assert.match(pickAsset(a, 'darwin', 'arm64').name, /arm64\.dmg$/);
  assert.match(pickAsset(a, 'darwin', 'arm64', true).name, /arm64\.zip$/);
  assert.match(pickAsset(a.filter((x) => !x.name.endsWith('.zip')), 'darwin', 'arm64', true).name, /\.dmg$/);
  assert.strictEqual(pickAsset(a, 'darwin', 'x64'), null);
  assert.match(pickAsset(a, 'win32', 'x64').name, /\.exe$/);
  assert.match(pickAsset(a, 'linux', 'x64').name, /\.AppImage$/);
});

test('checksum lookup', () => {
  const h = 'a'.repeat(64);
  assert.strictEqual(hashFor(`${h}  HitList-1.dmg\n${'b'.repeat(64)} *other.exe\n`, 'HitList-1.dmg'), h);
  assert.strictEqual(hashFor(`${h}  x\n`, 'y'), null);
});

function bodyOf(text, chunk = 2) {
  const buf = Buffer.from(text);
  let at = 0;
  return { getReader: () => ({ read: async () => (at >= buf.length ? { done: true } : { done: false, value: buf.subarray(at, (at += chunk)) }) }) };
}

function makeUpdater({ releases, current = '1.1.0', files = {}, platform = 'darwin', canSwap = false, install = async () => ({ ok: true }), slow = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const opened = [];
  const calls = [];
  const changes = [];
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    if (url.includes('/releases')) return { ok: true, status: 200, json: async () => releases };
    if (url in files) {
      if (url === slow) {
        // Never finishes by itself; ends when the download is cancelled.
        return { ok: true, status: 200, body: { getReader: () => ({ read: () => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')))) }) } };
      }
      return { ok: true, status: 200, body: bodyOf(String(files[url])), arrayBuffer: async () => Buffer.from(files[url]), text: async () => String(files[url]) };
    }
    return { ok: false, status: 404 };
  };
  const u = createUpdater({
    repo: 'o/r', currentVersion: current, platform, arch: 'arm64', fetch, downloadDir: dir, canSwap,
    installFile: install, openFile: async (f) => opened.push(f), onChange: (s) => changes.push(s),
  });
  return { u, dir, opened, calls, changes };
}

const release = (tag, extra = {}) => ({ tag_name: tag, name: tag, body: 'notes', draft: false, assets: assetsOf(tag.split('_')[1]), ...extra });

test('offers a newer release and says nothing when up to date', async () => {
  const a = makeUpdater({ releases: [release('HitList_1.2.0'), release('HitList_1.0.0')] });
  const s = await a.u.check();
  assert.strictEqual(s.phase, 'available');
  assert.strictEqual(s.latest.version, '1.2.0');
  const b = makeUpdater({ releases: [release('HitList_1.1.0')] });
  assert.strictEqual((await b.u.check()).phase, 'current');
});

test('a stable install is not offered a beta; a beta install is', async () => {
  const releases = [release('HitList_1.3.0-beta1')];
  assert.strictEqual((await makeUpdater({ releases }).u.check()).phase, 'current');
  assert.strictEqual((await makeUpdater({ releases, current: '1.2.0-beta1' }).u.check()).phase, 'available');
});

test('picks the highest release regardless of list order; ignores drafts', async () => {
  const s = await makeUpdater({ releases: [release('HitList_1.2.0'), release('HitList_1.9.0', { draft: true }), release('HitList_1.4.0')] }).u.check();
  assert.strictEqual(s.latest.version, '1.4.0');
});

test('offline or a bad reply is an error status, not a throw', async () => {
  const dir = os.tmpdir();
  const u = createUpdater({ repo: 'o/r', currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', fetch: async () => { throw new Error('offline'); }, downloadDir: dir, openFile: async () => {} });
  const s = await u.check();
  assert.strictEqual(s.phase, 'error');
  assert.strictEqual(s.error, 'offline');
});

test('a development run (no real version) does not check', async () => {
  const a = makeUpdater({ releases: [release('HitList_9.9.9')], current: '0.0.0-dev' });
  assert.strictEqual((await a.u.check()).error, 'dev-build');
  assert.strictEqual(a.calls.length, 0);
});

const sumsFor = (body, name) => `${crypto.createHash('sha256').update(body).digest('hex')}  ${name}\n`;

test('download shows growing progress, verifies, and stops at ready without opening anything', async () => {
  const body = 'hello';
  const name = 'HitList-1.2.0-arm64.dmg';
  const a = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': body, 'u/sums': sumsFor(body, name) } });
  await a.u.check();
  const s = await a.u.download();
  assert.strictEqual(s.phase, 'ready');
  assert.strictEqual(s.mode, 'open');
  assert.strictEqual(fs.readFileSync(path.join(a.dir, name), 'utf8'), body);
  assert.deepStrictEqual(a.opened, []);
  assert.ok(!fs.existsSync(path.join(a.dir, `${name}.part`)));
  const phases = a.changes.map((c) => c.phase);
  assert.ok(phases.indexOf('downloading') < phases.indexOf('verifying') && phases.indexOf('verifying') < phases.indexOf('ready'));
  const received = a.changes.filter((c) => c.progress).map((c) => c.progress.received);
  assert.deepStrictEqual(received, [...received].sort((x, y) => x - y));
  assert.strictEqual(a.changes.at(-1).progress.received, 5);
});

test('in open mode install opens the file; nothing restarts', async () => {
  const body = 'hello';
  const a = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': body, 'u/sums': sumsFor(body, 'HitList-1.2.0-arm64.dmg') } });
  await a.u.check(); await a.u.download();
  const out = await a.u.install();
  assert.strictEqual(out.restart, false);
  assert.strictEqual(a.opened.length, 1);
});

test('where the app can replace itself, the zip is chosen and install asks the caller to restart', async () => {
  const body = 'hello';
  let given = null;
  const a = makeUpdater({
    releases: [release('HitList_1.2.0')], canSwap: true,
    files: { 'u/zip': body, 'u/sums': sumsFor(body, 'HitList-1.2.0-arm64.zip') },
    install: async (x) => { given = x; return { ok: true }; },
  });
  const s = await a.u.check();
  assert.strictEqual(s.mode, 'swap');
  await a.u.download();
  const out = await a.u.install();
  assert.strictEqual(out.restart, true);
  assert.strictEqual(out.phase, 'installing');
  assert.match(given.file, /arm64\.zip$/);
  assert.deepStrictEqual(a.opened, []);
});

test('a failed swap falls back to opening the installer instead of losing the update', async () => {
  const body = 'hello';
  const a = makeUpdater({
    releases: [release('HitList_1.2.0')], canSwap: true,
    files: { 'u/zip': body, 'u/sums': sumsFor(body, 'HitList-1.2.0-arm64.zip') },
    install: async () => ({ ok: false, reason: 'unpack-failed' }),
  });
  await a.u.check(); await a.u.download();
  const out = await a.u.install();
  assert.strictEqual(out.restart, false);
  assert.strictEqual(out.phase, 'ready');
  assert.strictEqual(out.error, 'unpack-failed');
  assert.strictEqual(out.mode, 'open');
  assert.strictEqual((await a.u.install()).restart, false);
  assert.strictEqual(a.opened.length, 1);
});

test('a wrong checksum or size leaves nothing behind and can be retried', async () => {
  const name = 'HitList-1.2.0-arm64.dmg';
  const bad = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': 'hello', 'u/sums': `${'0'.repeat(64)}  ${name}\n` } });
  await bad.u.check();
  const s = await bad.u.download();
  assert.strictEqual(s.phase, 'error');
  assert.strictEqual(s.error, 'checksum-mismatch');
  assert.deepStrictEqual(fs.readdirSync(bad.dir), []);
  assert.ok(s.latest, 'the update is still known, so Try again works');
  assert.strictEqual((await bad.u.install()).restart, false);

  const short = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': 'hi', 'u/sums': sumsFor('hi', name) } });
  await short.u.check();
  assert.strictEqual((await short.u.download()).error, 'size-mismatch');
});

test('cancel stops a download, deletes the half file and keeps the update available', async () => {
  const a = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': 'hello', 'u/sums': sumsFor('hello', 'HitList-1.2.0-arm64.dmg') }, slow: 'u/dmg' });
  await a.u.check();
  const running = a.u.download();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(a.u.status().phase, 'downloading');
  a.u.cancel();
  const s = await running;
  assert.strictEqual(s.phase, 'available');
  assert.strictEqual(s.error, null);
  assert.deepStrictEqual(fs.readdirSync(a.dir), []);
});

test('a half file left by a quit mid-download is removed when the app starts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  fs.writeFileSync(path.join(dir, 'HitList-1.2.0-arm64.zip.part'), 'partial');
  createUpdater({ repo: 'o/r', currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', fetch: async () => {}, downloadDir: dir, openFile: async () => {} });
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('when the app cannot replace itself, the reason is passed on so the screen can say why', async () => {
  const body = 'hello';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const a = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': body, 'u/sums': sumsFor(body, 'HitList-1.2.0-arm64.dmg') } });
  const u = createUpdater({
    repo: 'o/r', currentVersion: '1.1.0', platform: 'darwin', arch: 'arm64', downloadDir: dir, canSwap: false, swapBlock: 'disk-image',
    fetch: async (url) => (url.includes('/releases') ? { ok: true, status: 200, json: async () => [release('HitList_1.2.0')] } : { ok: false, status: 404 }),
    openFile: async () => {},
  });
  const s = await u.check();
  assert.strictEqual(s.mode, 'open');
  assert.strictEqual(s.swapBlock, 'disk-image');
  assert.ok(a);
});
