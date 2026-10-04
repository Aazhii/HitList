/**
 * Finds a newer HitList on the project's GitHub Releases, downloads it with visible progress, checks it against the
 * release's SHA256SUMS, and hands it to the installer (installer.js) which replaces the app and restarts it.
 *
 * Phases: idle | checking | current | available | downloading | verifying | ready | installing | error.
 * Where the app cannot replace itself (not writable, run from a disk image, a .deb install) the installer file is
 * opened instead (`mode: 'open'`). The data folder is separate from the app, so replacing the app keeps every task.
 *
 * Pure, like backup.js: fetch, the file system location, "install this" and "open this file" are passed in.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const PROGRESS_EVERY_MS = 250;
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

/**
 * The file for this computer, or null. With `swap` true the file the installer can replace the app with is preferred
 * (the Mac zip); otherwise the one a person opens (the Mac dmg).
 */
function pickAsset(assets, platform, arch, swap = false) {
  const find = (re) => assets.find((a) => re.test(a.name)) || null;
  if (platform === 'darwin') {
    const zip = find(arch === 'arm64' ? /-arm64\.zip$/ : /-x64\.zip$/);
    const dmg = find(arch === 'arm64' ? /-arm64\.dmg$/ : /-x64\.dmg$/);
    return swap ? (zip || dmg) : (dmg || zip);
  }
  if (platform === 'win32') return find(/-x64\.exe$/);
  if (platform === 'linux') return find(/\.AppImage$/) || find(/\.deb$/);
  return null;
}

/** Can the installer replace the app with this file (rather than a person opening it)? */
function isSwapAsset(asset, platform) {
  if (platform === 'darwin') return /\.zip$/.test(asset.name);
  if (platform === 'win32') return /\.exe$/.test(asset.name);
  if (platform === 'linux') return /\.AppImage$/.test(asset.name);
  return false;
}

/** 'hash  filename' lines -> hash for one file name, or null. */
function hashFor(sumsText, fileName) {
  for (const line of String(sumsText).split('\n')) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && path.basename(m[2]) === fileName) return m[1].toLowerCase();
  }
  return null;
}

function createUpdater({
  repo, currentVersion, platform, arch, fetch, downloadDir, canSwap = false, swapBlock = null, installFile, openFile, onChange = () => {}, now = () => Date.now(),
}) {
  const current = parseVersion(currentVersion);
  let latest = null; // { version, name, notes, asset, sums, mode }
  let state = { phase: 'idle', checkedAt: 0, error: null, file: null, progress: null };
  let controller = null;
  let lastPush = 0;

  // A download that was cut off by a quit or a crash leaves a half file; it is never usable.
  try {
    for (const name of fs.readdirSync(downloadDir)) if (name.endsWith('.part')) fs.rmSync(path.join(downloadDir, name), { force: true });
  } catch { /* no folder yet */ }

  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'HitList-desktop' };

  const status = () => ({
    current: currentVersion,
    phase: state.phase,
    checkedAt: state.checkedAt,
    error: state.error,
    file: state.file,
    progress: state.progress,
    mode: latest ? latest.mode : null,
    // Why the app cannot replace itself here (and the installer is opened instead), when that is the case.
    swapBlock: latest && latest.mode === 'open' ? (latest.swapBlock || swapBlock) : null,
    latest: latest ? { version: latest.version, name: latest.name, notes: latest.notes, size: latest.asset.size } : null,
  });

  const set = (patch) => { state = { ...state, ...patch }; lastPush = now(); onChange(status()); };

  /** Looks for a newer release. Quiet on failure (offline is normal): the phase becomes 'error' and the next check retries. */
  async function check() {
    if (['checking', 'downloading', 'verifying', 'installing', 'ready'].includes(state.phase)) return status();
    if (!current) { set({ phase: 'error', error: 'dev-build' }); return status(); }
    set({ phase: 'checking', error: null });
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
        const asset = pickAsset(r.assets || [], platform, arch, canSwap);
        if (!asset) continue;
        if (!best || compareVersions(v, best.parsed) > 0) best = { parsed: v, r, asset };
      }
      if (best && compareVersions(best.parsed, current) > 0) {
        latest = {
          version: best.r.tag_name.replace(/^.*?(\d+\.\d+\.\d+.*)$/, '$1'),
          name: best.r.name || best.r.tag_name,
          notes: String(best.r.body || '').slice(0, 2000),
          asset: best.asset,
          sums: (best.r.assets || []).find((a) => a.name === 'SHA256SUMS.txt') || null,
          mode: canSwap && isSwapAsset(best.asset, platform) ? 'swap' : 'open',
        };
        set({ phase: 'available', checkedAt: now(), file: null, progress: null });
      } else {
        latest = null;
        set({ phase: 'current', checkedAt: now(), error: null, file: null, progress: null });
      }
    } catch (e) {
      set({ phase: 'error', checkedAt: now(), error: e && e.message ? e.message : 'failed' });
    }
    return status();
  }

  const fail = (code, part) => {
    if (part) fs.rmSync(part, { force: true });
    set({ phase: 'error', error: code, progress: null });
  };

  /** Downloads the installer into the updates folder with progress, verifies it, and stops at 'ready'. */
  async function download() {
    if (!latest || ['downloading', 'verifying', 'installing'].includes(state.phase)) return status();
    const asset = latest.asset;
    const target = path.join(downloadDir, asset.name);
    const part = `${target}.part`;
    controller = new AbortController();
    const { signal } = controller;
    const total = asset.size || 0;
    set({ phase: 'downloading', error: null, file: null, progress: { received: 0, total } });
    let fd = null;
    try {
      let expected = null;
      if (latest.sums) {
        const sumsRes = await fetch(latest.sums.browser_download_url, { headers: { 'User-Agent': 'HitList-desktop' }, redirect: 'follow', signal });
        if (!sumsRes.ok) throw new Error(`checksums ${sumsRes.status}`);
        expected = hashFor(await sumsRes.text(), asset.name);
        if (!expected) throw new Error('checksum-missing');
      }
      const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'HitList-desktop' }, redirect: 'follow', signal });
      if (!res.ok) throw new Error(`download ${res.status}`);
      fs.mkdirSync(downloadDir, { recursive: true });
      fd = fs.openSync(part, 'w');
      const hash = crypto.createHash('sha256');
      let received = 0;
      const take = (chunk) => {
        const buf = Buffer.from(chunk);
        hash.update(buf);
        fs.writeSync(fd, buf);
        received += buf.length;
        if (now() - lastPush >= PROGRESS_EVERY_MS) set({ progress: { received, total } });
      };
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          take(value);
        }
      } else {
        take(await res.arrayBuffer());
      }
      fs.closeSync(fd); fd = null;
      set({ phase: 'verifying', progress: { received, total: total || received } });
      if (total && received !== total) throw new Error('size-mismatch');
      if (expected && hash.digest('hex') !== expected) throw new Error('checksum-mismatch');
      fs.renameSync(part, target); // a half-written file never has the real name
      set({ phase: 'ready', file: target, progress: { received, total: received } });
    } catch (e) {
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
      if (signal.aborted) {
        fs.rmSync(part, { force: true });
        set({ phase: 'available', error: null, progress: null });
      } else {
        fail(e && e.message ? e.message : 'failed', part);
      }
    } finally {
      controller = null;
    }
    return status();
  }

  /** Stops a download in progress; the half file is deleted and the update stays available. */
  function cancel() {
    if (controller) controller.abort();
    return status();
  }

  /**
   * Starts using the downloaded file. In 'swap' mode the installer replaces the app and resolves { restart: true }:
   * the caller then quits the app so the helper can finish. In 'open' mode the file is opened for the person.
   */
  async function install() {
    if (state.phase !== 'ready' || !latest || !state.file) return { ...status(), restart: false };
    if (latest.mode === 'open') {
      await openFile(state.file);
      return { ...status(), restart: false };
    }
    set({ phase: 'installing', error: null });
    const out = await installFile({ file: state.file, asset: latest.asset });
    if (out && out.ok) return { ...status(), restart: true };
    // The in-place swap did not work: fall back to opening the installer so the update is not lost.
    latest = { ...latest, mode: 'open', swapBlock: out && out.reason ? out.reason : 'install-failed' };
    set({ phase: 'ready', error: out && out.reason ? out.reason : 'install-failed' });
    return { ...status(), restart: false };
  }

  /** First check shortly after launch, then once a day. Returns a stop function. */
  function startSchedule({ firstDelay = 60 * 1000, every = CHECK_INTERVAL } = {}) {
    const first = setTimeout(() => { void check(); }, firstDelay);
    const timer = setInterval(() => { void check(); }, every);
    first.unref?.(); timer.unref?.();
    return () => { clearTimeout(first); clearInterval(timer); };
  }

  return { check, download, cancel, install, status, startSchedule };
}

module.exports = { createUpdater, parseVersion, compareVersions, pickAsset, isSwapAsset, hashFor, CHECK_INTERVAL };
