import { afterEach, describe, expect, it } from 'vitest';
import { rememberClaimed, resolveSession, takeClaimedMessage } from '@/lib/session';

afterEach(() => sessionStorage.clear());

describe('session gate', () => {
  it('lets every non-Catalyst build straight in', async () => {
    const out = await resolveSession(async () => ({ mode: 'cookie', authenticated: true }));
    expect(out.kind).toBe('ready');
  });

  it('sends a signed-out Catalyst browser to the login page', async () => {
    const out = await resolveSession(async () => ({ mode: 'catalyst', authenticated: false, loginUrl: '/__catalyst/auth/login' }));
    expect(out).toEqual({ kind: 'login', url: '/__catalyst/auth/login' });
  });

  it('lets a signed-in Catalyst browser in', async () => {
    const out = await resolveSession(async () => ({ mode: 'catalyst', authenticated: true }));
    expect(out.kind).toBe('ready');
  });

  it('never turns a failed check into a wall', async () => {
    const out = await resolveSession(async () => { throw new Error('offline'); });
    expect(out).toEqual({ kind: 'ready', session: null });
  });

  it('says what a first sign-in brought in, once', () => {
    expect(takeClaimedMessage()).toBeNull();
    rememberClaimed({ KaizenTasks: 3, KaizenNotes: 1, KaizenLists: 2 });
    expect(takeClaimedMessage()).toBe('Brought 3 tasks and 1 note from this browser into your account.');
    expect(takeClaimedMessage()).toBeNull();
    rememberClaimed({});
    expect(takeClaimedMessage()).toBeNull();
  });
});
