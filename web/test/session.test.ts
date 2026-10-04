import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberClaimed, resolveSession, resolveStorageIdentity, takeClaimedMessage } from '@/lib/session';
import { getActiveUserId, loadAppState, saveAppState, setActiveTaskWorkspace, setActiveUserId } from '@/lib/storage';

afterEach(() => { sessionStorage.clear(); localStorage.clear(); setActiveUserId(null); vi.unstubAllGlobals(); });

describe('session gate', () => {
  it('uses the desktop cached identity offline and a separate signed-out namespace', async () => {
    const getAccount = vi.fn().mockResolvedValue({ userId: '12345', email: null });
    vi.stubGlobal('window', { hitlistDesktop: { getAccount } });
    expect(await resolveStorageIdentity(null)).toBe('12345');
    getAccount.mockResolvedValue(null);
    expect(await resolveStorageIdentity(null)).toBe('desktop-local-v1');
  });

  it('separates personal and shared task caches without changing the personal identity', () => {
    setActiveUserId('12345');
    const personal = loadAppState();
    personal.todos = [{ id: 'personal', text: 'Private', status: 'todo', quadrant: 'do', createdAt: 1, listId: 'private-list', order: 0 }];
    saveAppState(personal);
    setActiveTaskWorkspace('shared-workspace');
    expect(loadAppState().todos.some(todo => todo.id === 'personal')).toBe(false);
    expect(getActiveUserId()).toBe('12345');
    setActiveTaskWorkspace(null);
    expect(loadAppState().todos[0].id).toBe('personal');
  });
  it('does not migrate or expose account A tasks from the cache to account B', async () => {
    setActiveUserId(await resolveStorageIdentity({ mode: 'catalyst', authenticated: true, userId: '12345' }));
    const state = loadAppState();
    state.todos = [{ id: 'private-a', text: 'Account A private task', status: 'todo', quadrant: 'do', createdAt: 1, listId: 'private-list', order: 0 }];
    saveAppState(state);
    setActiveUserId(await resolveStorageIdentity({ mode: 'catalyst', authenticated: true, userId: '67890' }));
    expect(loadAppState().todos.some(todo => todo.id === 'private-a')).toBe(false);
    setActiveUserId(await resolveStorageIdentity({ mode: 'catalyst', authenticated: true, userId: '12345' }));
    expect(loadAppState().todos[0].id).toBe('private-a');
  });

  it('refuses an unknown authenticated identity and an offline browser identity', async () => {
    await expect(resolveStorageIdentity({ mode: 'catalyst', authenticated: true })).rejects.toThrow('storage identity');
    await expect(resolveStorageIdentity(null)).rejects.toThrow('workspace identity');
  });
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
