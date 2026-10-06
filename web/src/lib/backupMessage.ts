/** True when a backup before sign-out did not save the latest changes to the account (so the person should be told). */
export const signOutBackupFailed = (result: string | null): boolean =>
  result !== null && !['backed-up', 'unchanged', 'signed-out'].includes(result);

export const signOutBackupMessage = 'Could not back up before signing out. Your data is still on this computer; sign in again later to back it up.';

const SIGN_OUT_BACKUP_KEY = 'hitlist-signout-backup';

export function rememberSignOutBackup(result: string | null): void {
  try { if (result) sessionStorage.setItem(SIGN_OUT_BACKUP_KEY, result); } catch { return; }
}

export function takeSignOutBackup(): string | null {
  try {
    const result = sessionStorage.getItem(SIGN_OUT_BACKUP_KEY);
    sessionStorage.removeItem(SIGN_OUT_BACKUP_KEY);
    return result;
  } catch { return null; }
}

/** What a backup attempt says to the person, in a sentence. The shell reports a short code; this turns it into words. */
export function backupMessage(result: string): string {
  switch (result) {
    case 'backed-up': return 'Backed up to your account.';
    case 'unchanged': return 'Nothing has changed since the last backup.';
    case 'offline': return 'Could not reach the backup service. It will try again later.';
    case 'sign-in-needed': return 'Your sign-in expired. Sign out and sign in again to back up.';
    case 'daily-limit': return 'You have reached today\'s backup limit. It will back up again later.';
    case 'signed-out': return 'Sign in to back up.';
    case 'local-error': return 'Could not read your workspace to back it up.';
    default: return 'The backup did not complete. It will try again later.';
  }
}
