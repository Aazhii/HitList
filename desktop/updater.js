/**
 * Finds a newer HitList on the project's GitHub Releases and downloads it, checking the file against the release's SHA256SUMS.
 * Nothing is installed by this code: the person opens the downloaded file (a dmg is dragged over the old app, an exe
 * runs its installer). The data folder is separate from the app, so replacing the app keeps every task.
 *
 * Pure, like backup.js: fetch, the file system and "open this file" are passed in.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const STAGE_ORDER = { alpha: 1, beta: 2 };

/** '1.2.5' or '1.2.5-beta2' (a release tag like 'HitList_1.2.5' or 'v1.2.5' is also accepted) -> parts, or null. */
function parseVersion(text) {
  const m = /(?:^|[_v])(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)(\d+))?$/.exec(String(text || '').trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], stage: m[4] || null, stageNo: m[5] ? Number(m[5]) : 0 };
}

/** <0 if a is older than b, 0 if equal, >0 if newer. A plain release is newer than any alpha/beta of the same numbers. */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
  if (!a.stage && !b.stage) return 0;
  if (!a.stage) return 1;
  if (!b.stage) return -1;
  if (a.stage !== b.stage) return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
  return a.stageNo - b.stageNo;
}

/** The installer file for this computer, or null. */
function pickAsset(assets, platform, arch) {
  const find = (re) => assets.find((a) => re.test(a.name)) || null;
  if (platform === 'darwin') return find(arch === 'arm64' ? /-arm64\.dmg$/ : /-x64\.dmg$/);
  if (platform === 'win32') return find(/-x64\.exe$/);
  if (platform === 'linux') return find(/\.AppImage$/) || find(/\.deb$/);
  return null;
}

/** 'hash  filename' lines -> hash for one file name, or null. */
function hashFor(sumsText, fileName) {
  for (const line of String(sumsText).split('\n')) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && path.basename(m[2]) === fileName) return m[1].toLowerCase();
  }
  return null;
}

function createUpdater({ repo, currentVersion, platform, arch, fetch, downloadDir, openFile, now = () => Date.now() }) {
  const current = parseVersion(currentVersion);
  let latest = null; // { version, name, notes, asset, sums, url }
  let state = { phase: 'idle', checkedAt: 0, error: null, file: null };

  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'HitList-desktop' };

  const status = () => ({
    current: currentVersion,
    phase: state.phase, // idle | checking | current | available | downloading | downloaded | error
    checkedAt: state.checkedAt,
    error: state.error,
    file: state.file,
    latest: latest ? { version: latest.version, name: latest.name, notes: latest.notes, size: latest.asset.size } : null,
  });

  /** Looks for a newer release. Quiet on failure (offline is normal): the phase becomes 'error' and the next check retries. */
  async function check() {
    if (state.phase === 'checking' || state.phase === 'downloading') return status();
    if (!current) { state = { ...state, phase: 'error', error: 'dev-build' }; return status(); }
    state = { ...state, phase: 'checking', error: null };
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, { headers });
      if (!res.ok) throw new Error(`releases ${res.status}`);
      const releases = await res.json();
      let best = null;
      for (const r of releases) {
        if (r.draft) continue;
        const v = parseVersion(r.tag_name);
        if (!v) continue;
        if (v.stage && !current.stage) continue; // a stable install is only offered stable releases
        const asset = pickAsset(r.assets || [], platform, arch);
        if (!asset) continue;
        if (!best || compareVersions(v, best.parsed) > 0) best = { parsed: v, r, asset };
      }
      if (best && compareVersions(best.parsed, current) > 0) {
        const sums = (best.r.assets || []).find((a) => a.name === 'SHA256SUMS.txt') || null;
        latest = {
          version: best.r.tag_name.replace(/^.*?(\d+\.\d+\.\d+.*)$/, '$1'),
          name: best.r.name || best.r.tag_name,
          notes: String(best.r.body || '').slice(0, 2000),
          asset: best.asset,
          sums,
        };
        state = { ...state, phase: state.phase === 'downloaded' ? 'downloaded' : 'available', checkedAt: now() };
        if (state.phase === 'available') state.file = null;
      } else {
        latest = null;
        state = { phase: 'current', checkedAt: now(), error: null, file: null };
      }
    } catch (e) {
      state = { ...state, phase: 'error', checkedAt: now(), error: e && e.message ? e.message : 'failed' };
    }
    return status();
  }

  /** Downloads the installer into the Downloads folder, verifies it, then opens it. Resolves the new status. */
  async function download() {
    if (!latest || state.phase === 'downloading') return status();
    const target = path.join(downloadDir, latest.asset.name);
    state = { ...state, phase: 'downloading', error: null };
    try {
      const res = await fetch(latest.asset.browser_download_url, { headers: { 'User-Agent': 'HitList-desktop' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`download ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (latest.asset.size && bytes.length !== latest.asset.size) throw new Error('size-mismatch');
      if (latest.sums) {
        const sumsRes = await fetch(latest.sums.browser_download_url, { headers: { 'User-Agent': 'HitList-desktop' }, redirect: 'follow' });
        if (!sumsRes.ok) throw new Error(`checksums ${sumsRes.status}`);
        const expected = hashFor(await sumsRes.text(), latest.asset.name);
        if (!expected) throw new Error('checksum-missing');
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('checksum-mismatch');
      }
      fs.mkdirSync(downloadDir, { recursive: true });
      const part = `${target}.part`;
      fs.writeFileSync(part, bytes);
      fs.renameSync(part, target); // a half-written file never has the real name
      state = { ...state, phase: 'downloaded', file: target };
      await openFile(target);
    } catch (e) {
      state = { ...state, phase: 'error', error: e && e.message ? e.message : 'failed' };
    }
    return status();
  }

  /** First check shortly after launch, then once a day. Returns a stop function. */
  function startSchedule({ firstDelay = 60 * 1000, every = CHECK_INTERVAL } = {}) {
    const first = setTimeout(() => { void check(); }, firstDelay);
    const timer = setInterval(() => { void check(); }, every);
    first.unref?.(); timer.unref?.();
    return () => { clearTimeout(first); clearInterval(timer); };
  }

  return { check, download, status, startSchedule };
}

module.exports = { createUpdater, parseVersion, compareVersions, pickAsset, hashFor, CHECK_INTERVAL };
