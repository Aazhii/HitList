import { describe, expect, it } from 'vitest';
import { backupMessage } from '@/lib/backupMessage';

describe('backupMessage', () => {
  it('has a sentence for every outcome the shell reports', () => {
    for (const code of ['backed-up', 'unchanged', 'offline', 'sign-in-needed', 'signed-out', 'local-error', 'error']) {
      expect(backupMessage(code).length).toBeGreaterThan(10);
    }
    expect(backupMessage('sign-in-needed')).toMatch(/sign in again/);
    expect(backupMessage('something-new')).toMatch(/try again/);
  });
});
