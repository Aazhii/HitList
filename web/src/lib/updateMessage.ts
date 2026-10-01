/** What the update screen says. The desktop shell reports a phase and short codes; these are the words. */
export interface UpdateStatus {
  current: string;
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'error';
  checkedAt: number;
  error: string | null;
  file: string | null;
  latest: { version: string; name: string; notes: string; size: number } | null;
}

export function sizeLabel(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

/** One sentence for the current state. */
export function updateHeadline(s: UpdateStatus): string {
  switch (s.phase) {
    case 'checking': return 'Checking for updates…';
    case 'available': return `Version ${s.latest?.version ?? ''} is available.`;
    case 'downloading': return 'Downloading the update…';
    case 'downloaded': return 'Downloaded. Open it to install.';
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
    case 'dev-build': return 'This is a development run; updates apply to installed apps.';
    default: return 'Could not reach the update server. Try again when you are online.';
  }
}

/** What to do with the downloaded file, per computer. */
export function installHint(platform: string): string {
  if (/mac/i.test(platform)) return 'Drag HitList onto the Applications folder and choose Replace. Your tasks are kept.';
  if (/win/i.test(platform)) return 'Run the installer. Your tasks are kept.';
  return 'Run the new AppImage (or install the .deb). Your tasks are kept.';
}
