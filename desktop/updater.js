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

/** The version written in free text: "HitList 1.1.27", "HitList_1.1.27", "v1.2.0-beta1", "HitList-1.1.27-arm64.dmg". Null if none. */
function versionIn(text) {
  const m = /(\d+\.\d+\.\d+(?:-(?:alpha|beta)\d+)?)/.exec(String(text || ''));
  return m ? parseVersion(m[1]) : null;
}
const versionText = (v) => `${v.nums.join('.')}${v.stage ? `-${v.stage}${v.stageNo}` : ''}`;

/** What kind of file a person may hand in, per computer: the installer this platform's release builds. */
const FILE_PATTERNS = {
  darwin: /^HitList-\d+\.\d+\.\d+(?:-(?:alpha|beta)\d+)?-(arm64|x64)\.(dmg|zip)$/i,
  win32: /^HitList-Setup-\d+\.\d+\.\d+(?:-(?:alpha|beta)\d+)?-x64\.exe$/i,
  linux: /^HitList-\d+\.\d+\.\d+(?:-(?:alpha|beta)\d+)?-x64\.AppImage$/i,
};

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

  const directionOf = (version) => {
    const v = parseVersion(version) || versionIn(version);
    if (!v || !current) return null;
    const c = compareVersions(v, current);
    return c > 0 ? 'newer' : c < 0 ? 'older' : 'same';
  };

  const status = () => ({
    current: currentVersion,
    phase: state.phase,
    checkedAt: state.checkedAt,
    error: state.error,
    file: state.file,
    progress: state.progress,
    mode: latest ? latest.mode : null,
    /** A version the person asked for by name, or a file they handed in, rather than the newest release. */
    requested: !!(latest && (latest.requested || latest.fromFile)),
    fromFile: !!(latest && latest.fromFile),
    /** Whether the chosen version is newer, older (a downgrade) or the same as the one installed. */
    direction: latest ? directionOf(latest.version) : null,
    /** For a file: true when its checksum matched a SHA256SUMS.txt beside it, false when there was none to check against. */
    verified: latest && latest.fromFile ? latest.verified : null,
    // Why the app cannot replace itself here (and the installer is opened instead), when that is the case.
    swapBlock: latest && latest.mode === 'open' ? (latest.swapBlock || swapBlock) : null,
    latest: latest ? { version: latest.version, name: latest.name, notes: latest.notes, size: latest.asset.size } : null,
  });

  const set = (patch) => { state = { ...state, ...patch }; lastPush = now(); onChange(status()); };

  /** Looks for a newer release. Quiet on failure (offline is normal): the phase becomes 'error' and the next check retries. */
  async function check({ force = false } = {}) {
    if (['checking', 'downloading', 'verifying', 'installing'].includes(state.phase)) return status();
    // A version the person picked, or a file they chose, is not swapped for the newest release behind their back.
    // Only an explicit "check again" (force) goes back to looking for the latest.
    if (latest && (latest.requested || latest.fromFile) && !force) return status();
    if (force && latest && (latest.requested || latest.fromFile)) { latest = null; state = { ...state, phase: 'idle', file: null, progress: null, error: null }; }
    if (!current) { set({ phase: 'error', error: 'dev-build' }); return status(); }
    // An update that is downloaded and waiting stays on screen while we look: only a NEWER release replaces it.
    const staged = state.phase === 'ready' && latest ? latest : null;
    if (!staged) set({ phase: 'checking', error: null });
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
      if (staged && !(best && compareVersions(best.parsed, parseVersion(staged.version) || current) > 0)) {
        set({ checkedAt: now() }); // nothing newer than what is already downloaded
        return status();
      }
      if (best && compareVersions(best.parsed, current) > 0) {
        // A newer release than the downloaded one: the old file is no use any more.
        if (staged && state.file) fs.rmSync(state.file, { force: true });
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
      // Offline while an update is waiting: it is still there to install.
      if (staged) return status();
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
    // Installers of other versions that were downloaded and never used are removed, so they do not pile up.
    try {
      for (const name of fs.readdirSync(downloadDir)) {
        if (name !== asset.name && /^HitList.*\.(zip|dmg|exe|AppImage|deb)$/.test(name)) fs.rmSync(path.join(downloadDir, name), { force: true });
      }
    } catch { /* no folder yet */ }
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

  /**
   * A specific version, by name: "1.1.27", "HitList 1.1.27", "HitList_1.1.27", "v1.2.0-beta1". Looks through the project's releases
   * for it (newer, older or the same as the installed one) and offers its installer for this computer; Download and Restart then
   * work as for any update. Nothing is changed until the person installs it.
   */
  async function checkVersion(text) {
    if (['checking', 'downloading', 'verifying', 'installing'].includes(state.phase)) return status();
    const wanted = versionIn(text);
    if (!wanted) { set({ phase: 'error', error: 'bad-version' }); return status(); }
    const before = state;
    set({ phase: 'checking', error: null });
    try {
      let found = null;
      const limited = (res) => res.status === 403 || res.status === 429;
      // Straight to the release by its tag (one small request, so a name like "1.1.33" does not page through every release);
      // older releases are tagged "HitList_x", newer ones "vx". The scan below is the fallback for any other tag.
      const wantedText = versionText(wanted);
      for (const tag of [`HitList_${wantedText}`, `v${wantedText}`, wantedText]) {
        if (found) break;
        let res;
        try { res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers }); } catch { break; }
        if (limited(res)) { set({ phase: 'error', error: 'rate-limited', checkedAt: now() }); return status(); }
        if (!res.ok) continue;
        const r = await res.json();
        const v = r && !Array.isArray(r) && !r.draft ? versionIn(r.tag_name) : null;
        if (v && compareVersions(v, wanted) === 0) found = r;
      }
      for (let page = 1; page <= 5 && !found; page += 1) {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
        if (limited(res)) { set({ phase: 'error', error: 'rate-limited', checkedAt: now() }); return status(); }
        if (!res.ok) throw new Error(`releases ${res.status}`);
        const releases = await res.json();
        if (!releases.length) break;
        found = releases.find((r) => !r.draft && (() => { const v = versionIn(r.tag_name); return v && compareVersions(v, wanted) === 0; })()) || null;
      }
      if (!found) { set({ phase: 'error', error: 'version-not-found', checkedAt: now() }); return status(); }
      const asset = pickAsset(found.assets || [], platform, arch, canSwap);
      if (!asset) { set({ phase: 'error', error: 'no-installer', checkedAt: now() }); return status(); }
      if (before.phase === 'ready' && before.file && !(latest && latest.fromFile)) fs.rmSync(before.file, { force: true });
      latest = {
        version: versionText(wanted),
        name: found.name || found.tag_name,
        notes: String(found.body || '').slice(0, 2000),
        asset,
        sums: (found.assets || []).find((a) => a.name === 'SHA256SUMS.txt') || null,
        mode: canSwap && isSwapAsset(asset, platform) ? 'swap' : 'open',
        requested: true,
      };
      set({ phase: 'available', checkedAt: now(), file: null, progress: null, error: null });
    } catch (e) {
      set({ phase: 'error', checkedAt: now(), error: e && e.message ? e.message : 'failed' });
    }
    return status();
  }

  /**
   * A file the person already downloaded (the .dmg on a Mac, the installer .exe, the .AppImage): checks its name, that it is for
   * this kind of computer, and its checksum when a SHA256SUMS.txt sits beside it, then readies it like a download. Their file is
   * only read, never moved or deleted.
   */
  async function useFile(filePath) {
    if (['checking', 'downloading', 'verifying', 'installing'].includes(state.phase)) return status();
    const pattern = FILE_PATTERNS[platform];
    const name = path.basename(String(filePath || ''));
    let stat = null;
    try { stat = fs.statSync(filePath); } catch { /* reported below */ }
    if (!pattern || !stat || !stat.isFile()) { set({ phase: 'error', error: 'file-missing' }); return status(); }
    const m = pattern.exec(name);
    const version = versionIn(name);
    if (!m || !version) { set({ phase: 'error', error: 'not-a-hitlist-file' }); return status(); }
    if (platform === 'darwin' && m[1].toLowerCase() !== arch) { set({ phase: 'error', error: 'wrong-architecture' }); return status(); }
    set({ phase: 'verifying', error: null, progress: { received: 0, total: stat.size } });
    let verified = false;
    try {
      const sumsPath = path.join(path.dirname(filePath), 'SHA256SUMS.txt');
      const expected = fs.existsSync(sumsPath) ? hashFor(fs.readFileSync(sumsPath, 'utf8'), name) : null;
      if (expected) {
        const hash = crypto.createHash('sha256');
        const fd = fs.openSync(filePath, 'r');
        try {
          const buf = Buffer.allocUnsafe(1024 * 1024);
          let read;
          while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, read));
        } finally { fs.closeSync(fd); }
        if (hash.digest('hex') !== expected) { set({ phase: 'error', error: 'checksum-mismatch', progress: null }); return status(); }
        verified = true;
      }
    } catch {
      set({ phase: 'error', error: 'file-missing', progress: null });
      return status();
    }
    const asset = { name, size: stat.size };
    const swappable = platform === 'darwin' ? /\.(dmg|zip)$/i.test(name) : true;
    latest = {
      version: versionText(version),
      name: `HitList ${versionText(version)} (from a file)`,
      notes: '',
      asset,
      sums: null,
      mode: canSwap && swappable ? 'swap' : 'open',
      fromFile: true,
      verified,
    };
    set({ phase: 'ready', file: filePath, progress: { received: stat.size, total: stat.size }, error: null });
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

  return { check, checkVersion, useFile, download, cancel, install, status };
}

module.exports = { createUpdater, parseVersion, versionIn, compareVersions, pickAsset, isSwapAsset, hashFor };
