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
  { name: `HitList-Setup-${ver}-x64.exe`, size: 5, browser_download_url: 'u/exe' },
  { name: `HitList-${ver}-x64.AppImage`, size: 5, browser_download_url: 'u/ai' },
  { name: `HitList_${ver}_amd64.deb`, size: 5, browser_download_url: 'u/deb' },
  { name: 'SHA256SUMS.txt', size: 1, browser_download_url: 'u/sums' },
];

test('the right installer per computer', () => {
  const a = assetsOf('1.2.5');
  assert.match(pickAsset(a, 'darwin', 'arm64').name, /arm64\.dmg$/);
  assert.strictEqual(pickAsset(a, 'darwin', 'x64'), null);
  assert.match(pickAsset(a, 'win32', 'x64').name, /\.exe$/);
  assert.match(pickAsset(a, 'linux', 'x64').name, /\.AppImage$/);
});

test('checksum lookup', () => {
  const h = 'a'.repeat(64);
  assert.strictEqual(hashFor(`${h}  HitList-1.dmg\n${'b'.repeat(64)} *other.exe\n`, 'HitList-1.dmg'), h);
  assert.strictEqual(hashFor(`${h}  x\n`, 'y'), null);
});

function makeUpdater({ releases, current = '1.1.0', files = {}, platform = 'darwin' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const opened = [];
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('/releases')) return { ok: true, status: 200, json: async () => releases };
    if (url in files) return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(files[url]), text: async () => String(files[url]) };
    return { ok: false, status: 404 };
  };
  const u = createUpdater({ repo: 'o/r', currentVersion: current, platform, arch: 'arm64', fetch, downloadDir: dir, openFile: async (f) => opened.push(f) });
  return { u, dir, opened, calls };
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

test('download verifies the checksum, saves under the real name, and opens it', async () => {
  const body = 'hello';
  const name = 'HitList-1.2.0-arm64.dmg';
  const sum = crypto.createHash('sha256').update(body).digest('hex');
  const a = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': body, 'u/sums': `${sum}  ${name}\n` } });
  await a.u.check();
  const s = await a.u.download();
  assert.strictEqual(s.phase, 'downloaded');
  assert.strictEqual(fs.readFileSync(path.join(a.dir, name), 'utf8'), body);
  assert.deepStrictEqual(a.opened, [path.join(a.dir, name)]);
  assert.ok(!fs.existsSync(path.join(a.dir, `${name}.part`)));
});

test('a wrong checksum or size saves and opens nothing', async () => {
  const name = 'HitList-1.2.0-arm64.dmg';
  const bad = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': 'hello', 'u/sums': `${'0'.repeat(64)}  ${name}\n` } });
  await bad.u.check();
  const s = await bad.u.download();
  assert.strictEqual(s.phase, 'error');
  assert.strictEqual(s.error, 'checksum-mismatch');
  assert.deepStrictEqual(fs.readdirSync(bad.dir), []);
  assert.deepStrictEqual(bad.opened, []);

  const short = makeUpdater({ releases: [release('HitList_1.2.0')], files: { 'u/dmg': 'hi', 'u/sums': '' } });
  await short.u.check();
  assert.strictEqual((await short.u.download()).error, 'size-mismatch');
});
