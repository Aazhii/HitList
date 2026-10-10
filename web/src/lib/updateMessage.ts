/** What the update screen says. The desktop shell reports a phase and short codes; these are the words. */
export interface UpdateStatus {
  current: string;
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';
  checkedAt: number;
  error: string | null;
  file: string | null;
  progress: { received: number; total: number } | null;
  /** 'swap': HitList replaces itself and restarts. 'open': the downloaded installer is opened for the person. */
  mode: 'swap' | 'open' | null;
  /** Why HitList could not replace itself here, when the last step opens the installer instead. */
  swapBlock?: string | null;
  latest: { version: string; name: string; notes: string; size: number } | null;
  /** True when the version was asked for by name or came from a file, not found by the daily check. */
  requested?: boolean;
  fromFile?: boolean;
  /** Against the running version. An older one needs the person's confirmation. */
  direction?: 'newer' | 'older' | 'same' | null;
  /** For a chosen file: whether its checksum was confirmed (null when not from a file). */
  verified?: boolean | null;
}

export function sizeLabel(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

/** 0 to 100, or null when the total is not known. */
export function percentOf(progress: UpdateStatus['progress']): number | null {
  if (!progress || !progress.total) return null;
  return Math.min(100, Math.floor((progress.received / progress.total) * 100));
}

/** 'Downloaded 42 of 198 MB (21%)'. */
export function progressLabel(progress: UpdateStatus['progress']): string {
  if (!progress) return '';
  const pct = percentOf(progress);
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);
  return progress.total
    ? `${mb(progress.received)} of ${mb(progress.total)} MB${pct === null ? '' : ` (${pct}%)`}`
    : `${mb(progress.received)} MB`;
}

/** The three steps of an update, and where each stands. */
export type StepState = 'todo' | 'active' | 'done' | 'failed';
export function updateSteps(s: UpdateStatus): { download: StepState; verify: StepState; install: StepState } {
  const failed = s.phase === 'error';
  switch (s.phase) {
    case 'downloading': return { download: 'active', verify: 'todo', install: 'todo' };
    case 'verifying': return { download: 'done', verify: 'active', install: 'todo' };
    case 'ready': return { download: 'done', verify: 'done', install: s.error ? 'failed' : 'todo' };
    case 'installing': return { download: 'done', verify: 'done', install: 'active' };
    default:
      if (failed && /checksum|size-mismatch/.test(s.error ?? '')) return { download: 'done', verify: 'failed', install: 'todo' };
      if (failed) return { download: 'failed', verify: 'todo', install: 'todo' };
      return { download: 'todo', verify: 'todo', install: 'todo' };
  }
}

/** One sentence for the current state. */
export function updateHeadline(s: UpdateStatus): string {
  switch (s.phase) {
    case 'checking': return 'Checking for updates…';
    case 'available': return s.requested && s.direction === 'older' ? `Version ${s.latest?.version ?? ''} is older than the one you have.`
      : s.requested && s.direction === 'same' ? `Version ${s.latest?.version ?? ''} is the one you already have.`
      : `Version ${s.latest?.version ?? ''} is available.`;
    case 'downloading': return `Downloading version ${s.latest?.version ?? ''}…`;
    case 'verifying': return 'Checking the download…';
    case 'ready': return s.error ? updateErrorMessage(s.error) : s.fromFile ? `Ready to install version ${s.latest?.version ?? ''} from your file.` : s.mode === 'swap' ? 'Ready to install. HitList will restart.' : 'Downloaded. Open it to install.';
    case 'installing': return 'Installing. HitList is restarting…';
    case 'current': return 'HitList is up to date.';
    case 'error': return updateErrorMessage(s.error);
    default: return 'Check whether a newer HitList is available.';
  }
}

export function updateErrorMessage(code: string | null): string {
  switch (code) {
    case 'checksum-mismatch':
    case 'checksum-missing':
    case 'size-mismatch': return 'The download did not match its checksum, so it was thrown away. Try again.';
    case 'bad-version': return 'Type a version such as 1.1.27 or HitList 1.1.27.';
    case 'version-not-found': return 'No published release has that version.';
    case 'rate-limited': return 'GitHub is limiting requests from this network right now. Wait a few minutes and try again.';
    case 'no-installer': return 'That release has no installer for this computer.';
    case 'file-missing': return 'That file could not be read.';
    case 'not-a-hitlist-file': return 'That is not a HitList installer for this computer.';
    case 'wrong-architecture': return 'That installer is for a different kind of processor (Apple silicon vs Intel).';
    case 'dev-build': return 'This is a development run; updates apply to installed apps.';
    case 'unpack-failed':
    case 'bad-package':
    case 'install-failed':
    case 'not-installed': return 'HitList could not replace itself here. Open the installer to finish the update by hand.';
    default: return 'Could not reach the update server. Try again when you are online.';
  }
}

/** Why this install cannot update itself, in a sentence. */
export function swapBlockMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'disk-image': return 'HitList is running from the disk image. Move it to the Applications folder first, then update from there.';
    case 'translocated': return 'macOS is running HitList from a temporary location. Move it to the Applications folder, open it from there, and update again.';
    case 'not-writable': return 'HitList is installed somewhere this account cannot change, so it cannot replace itself.';
    case 'other-disk': return 'HitList is on a different disk than the update files, so it cannot replace itself.';
    case 'package-install': return 'HitList was installed from a package (.deb), which cannot replace itself. Install the new package.';
    case 'dev-run': return 'This is a development run; installed apps update themselves.';
    default: return 'HitList could not replace itself here.';
  }
}

/** What to do with the downloaded file, per computer, when HitList could not replace itself. */
export function installHint(platform: string): string {
  if (/mac/i.test(platform)) return 'Drag HitList onto the Applications folder and choose Replace. Your tasks are kept.';
  if (/win/i.test(platform)) return 'Run the installer. Your tasks are kept.';
  return 'Run the new AppImage (or install the .deb). Your tasks are kept.';
}
