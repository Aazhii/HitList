import { describe, expect, it } from 'vitest';
import { hasRestoreOffer, noOfferMessage, offerMessage, resultMessage } from '@/lib/restoreMessage';

describe('restoreMessage', () => {
  it('offers a restore on an empty install and the missing items from another device, and nothing otherwise', () => {
    expect(hasRestoreOffer({ state: 'restore-available' })).toBe(true);
    expect(hasRestoreOffer({ state: 'newer-elsewhere' })).toBe(true);
    for (const s of ['none', 'skipped', 'in-sync', 'local-is-newer', 'offline', 'signed-out']) expect(hasRestoreOffer({ state: s })).toBe(false);
    expect(offerMessage({ state: 'restore-available', at: Date.UTC(2026, 9, 1, 9, 40) })?.action).toBe('Restore');
    expect(offerMessage({ state: 'newer-elsewhere', at: 1 })?.action).toMatch(/missing/);
    expect(offerMessage({ state: 'in-sync' })).toBeNull();
  });

  it('has a sentence for every state a person can ask about', () => {
    for (const s of ['none', 'in-sync', 'local-is-newer', 'offline', 'signed-out', 'whatever']) expect(noOfferMessage({ state: s }).length).toBeGreaterThan(10);
  });

  it('says what was restored, and that nothing changed when it failed', () => {
    expect(resultMessage({ result: 'restored', imported: { KaizenTasks: 3, KaizenNotes: 1, KaizenLists: 4 } })).toBe('Restored 3 tasks, 1 note. Anything already here was left as it is.');
    expect(resultMessage({ result: 'restored', imported: { KaizenTasks: 0 } })).toMatch(/already here/);
    for (const r of ['offline', 'damaged', 'none', 'local-error']) expect(resultMessage({ result: r })).toMatch(/Nothing was changed|no backup/);
  });
});
