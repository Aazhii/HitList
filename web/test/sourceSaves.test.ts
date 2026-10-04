import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe('global source save drain', () => {
  it('tracks an API value write globally without any mounted workspace', async () => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { databaseApi } = await import('@/lib/api');
    const { prepareForSignOut } = await import('@/lib/preLogout');
    const write = databaseApi.setFieldValue('r1', 'f1', 'Saved');
    let done = false;
    const logout = prepareForSignOut().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    release(new Response(JSON.stringify({ recordId: 'r1', fieldId: 'f1', value: 'Saved' }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    await write;
    await logout;
    expect(done).toBe(true);
  });

  it('waits for writes after the workspace save barrier unmounts', async () => {
    const { onSourceSave, trackSourceWrite } = await import('@/lib/sourceSaves');
    const { prepareForSignOut } = await import('@/lib/preLogout');
    let release!: () => void;
    const write = trackSourceWrite(new Promise<void>(resolve => { release = resolve; }));
    const unmount = onSourceSave(async () => {});
    unmount();
    let done = false;
    const logout = prepareForSignOut().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await write;
    await logout;
    expect(done).toBe(true);
  });

  it('keeps failed writes blocking both logout and workspace switches', async () => {
    const { trackSourceWrite, flushSourceSaves, waitForSourceWrites } = await import('@/lib/sourceSaves');
    const { prepareForSignOut } = await import('@/lib/preLogout');
    await expect(trackSourceWrite(Promise.reject(new Error('write failed')))).rejects.toThrow('write failed');
    await waitForSourceWrites();
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(flushSourceSaves()).rejects.toThrow('A source edit could not be saved');
      await expect(prepareForSignOut()).rejects.toThrow('write failed');
    }
  });

  it('drains a write queued by a settling write before logout', async () => {
    const { trackSourceWrite } = await import('@/lib/sourceSaves');
    const { prepareForSignOut } = await import('@/lib/preLogout');
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = trackSourceWrite(new Promise<void>(resolve => { releaseFirst = resolve; }));
    const second = first.then(() => trackSourceWrite(new Promise<void>(resolve => { releaseSecond = resolve; })));
    let done = false;
    const logout = prepareForSignOut().then(() => { done = true; });
    releaseFirst();
    await first;
    await Promise.resolve();
    expect(done).toBe(false);
    releaseSecond();
    await second;
    await logout;
    expect(done).toBe(true);
  });
});