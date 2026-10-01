/** What the restore check and a restore say to the person (the shell reports short codes; these are the words). */
export interface RestoreCheck { state: string; at?: number; backups?: number }
export interface RestoreResult { result: string; imported?: Record<string, number>; skipped?: Record<string, number> }

const when = (at?: number) => (at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'earlier');

/** True when there is something to offer. */
export const hasRestoreOffer = (c: RestoreCheck) => c.state === 'restore-available' || c.state === 'newer-elsewhere';

export function offerMessage(c: RestoreCheck): { title: string; action: string } | null {
  if (c.state === 'restore-available') return { title: `A backup from ${when(c.at)} is available for your account.`, action: 'Restore' };
  if (c.state === 'newer-elsewhere') return { title: `A newer backup from ${when(c.at)} was made on another device.`, action: 'Bring in what is missing' };
  return null;
}

/** For someone who asked from the menu: a sentence for the states with nothing to offer. */
export function noOfferMessage(c: RestoreCheck): string {
  switch (c.state) {
    case 'none': return 'There is no backup for your account yet.';
    case 'in-sync': return 'Your workspace already matches your latest backup.';
    case 'local-is-newer': return 'This device already has everything in your latest backup.';
    case 'offline': return 'Could not reach the backup service. Try again when you are online.';
    case 'signed-out': return 'Sign in to restore a backup.';
    default: return 'Nothing to restore.';
  }
}

export function resultMessage(r: RestoreResult): string {
  if (r.result !== 'restored') {
    return r.result === 'offline' ? 'Could not reach the backup service. Nothing was changed.'
      : r.result === 'damaged' ? 'The backup could not be read. Nothing was changed.'
      : r.result === 'none' ? 'There is no backup to restore.'
      : 'The restore did not complete. Nothing was changed.';
  }
  const names: Array<[string, string, string]> = [['KaizenTasks', 'task', 'tasks'], ['KaizenNotes', 'note', 'notes'], ['KaizenDatabases', 'database', 'databases']];
  const parts = names.map(([k, one, many]) => [r.imported?.[k] ?? 0, one, many] as const).filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return parts.length ? `Restored ${parts.join(', ')}. Anything already here was left as it is.` : 'Everything in the backup was already here.';
}
