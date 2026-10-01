import { describe, expect, it } from 'vitest';
import { backupMessage, signOutBackupFailed } from '@/lib/backupMessage';

describe('backupMessage', () => {
  it('has a sentence for every outcome the shell reports', () => {
    for (const code of ['backed-up', 'unchanged', 'offline', 'sign-in-needed', 'signed-out', 'local-error', 'daily-limit', 'error']) {
      expect(backupMessage(code).length).toBeGreaterThan(10);
    }
    expect(backupMessage('sign-in-needed')).toMatch(/sign in again/);
    expect(backupMessage('something-new')).toMatch(/try again/);
  });

  it('warns after signing out only when the last changes did not reach the account', () => {
    for (const ok of [null, 'backed-up', 'unchanged', 'signed-out']) expect(signOutBackupFailed(ok)).toBe(false);
    for (const bad of ['offline', 'timeout', 'error', 'daily-limit', 'sign-in-needed']) expect(signOutBackupFailed(bad)).toBe(true);
  });
});
