/** What a backup attempt says to the person, in a sentence. The shell reports a short code; this turns it into words. */
export function backupMessage(result: string): string {
  switch (result) {
    case 'backed-up': return 'Backed up to your account.';
    case 'unchanged': return 'Nothing has changed since the last backup.';
    case 'offline': return 'Could not reach the backup service. It will try again later.';
    case 'sign-in-needed': return 'Your sign-in expired. Sign out and sign in again to back up.';
    case 'signed-out': return 'Sign in to back up.';
    case 'local-error': return 'Could not read your workspace to back it up.';
    default: return 'The backup did not complete. It will try again later.';
  }
}
