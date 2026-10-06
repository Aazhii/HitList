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

  it('stops reporting a failed write once the same edit has been saved after all', async () => {
    const { trackSourceWrite, flushSourceSaves, waitForSourceWrites } = await import('@/lib/sourceSaves');
    const { prepareForSignOut } = await import('@/lib/preLogout');
    await expect(trackSourceWrite(Promise.reject(new Error('offline')), 'PUT /field-values/r1/f1')).rejects.toThrow('offline');
    await waitForSourceWrites();
    await expect(flushSourceSaves()).rejects.toThrow('PUT /field-values/r1/f1');
    await expect(prepareForSignOut()).rejects.toThrow('offline');
    // The same edit is retried and saves: nothing is blocked any more.
    await trackSourceWrite(Promise.resolve('ok'), 'PUT /field-values/r1/f1');
    await waitForSourceWrites();
    await expect(flushSourceSaves()).resolves.toBeUndefined();
    await expect(prepareForSignOut()).resolves.toBeUndefined();
  });

  it('a different edit saving does not hide a failed one', async () => {
    const { trackSourceWrite, flushSourceSaves, waitForSourceWrites } = await import('@/lib/sourceSaves');
    await expect(trackSourceWrite(Promise.reject(new Error('x')), 'PUT /field-values/r1/f1')).rejects.toThrow('x');
    await trackSourceWrite(Promise.resolve('ok'), 'PUT /field-values/r2/f1');
    await waitForSourceWrites();
    await expect(flushSourceSaves()).rejects.toThrow('A source edit could not be saved');
  });

  it('a task made from a note is not stopped by an unrelated failed database edit, but still saves the note first', async () => {
    const { trackSourceWrite, flushSourceSaves, onSourceSave, waitForSourceWrites } = await import('@/lib/sourceSaves');
    const order: string[] = [];
    onSourceSave(async () => { order.push('note-saved'); });
    await expect(trackSourceWrite(Promise.reject(new Error('x')), 'POST /views')).rejects.toThrow('x');
    await waitForSourceWrites();
    await expect(flushSourceSaves({ ignoreFailedWrites: true })).resolves.toBeUndefined();
    expect(order).toEqual(['note-saved']);
    await expect(flushSourceSaves()).rejects.toThrow('A source edit could not be saved');
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