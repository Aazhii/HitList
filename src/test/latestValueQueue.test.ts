import { describe, expect, it, vi } from 'vitest';
import { LatestValueQueue } from '@/lib/latestValueQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('LatestValueQueue', () => {
  it('serializes rapid task-field edits and never applies a stale response', async () => {
    const queue = new LatestValueQueue<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    const send = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let displayed = 'before';
    const apply = (value: string) => { displayed = value; };

    const firstWrite = queue.submit('task-1:field-1', 'before', 'first', () => send(), apply, vi.fn());
    const secondWrite = queue.submit('task-1:field-1', 'before', 'second', () => send(), apply, vi.fn());
    expect(displayed).toBe('second');

    first.resolve('first');
    await expect(firstWrite).resolves.toBe(true);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
    expect(displayed).toBe('second');

    second.resolve('second');
    await expect(secondWrite).resolves.toBe(true);
    expect(displayed).toBe('second');
  });

  it('does not roll back a later custom-record value when an earlier write fails', async () => {
    const queue = new LatestValueQueue<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    const onFailure = vi.fn();
    let displayed = 'before';
    const apply = (value: string) => { displayed = value; };

    const firstWrite = queue.submit('record-1:field-1', 'before', 'first', () => first.promise, apply, onFailure);
    const secondWrite = queue.submit('record-1:field-1', 'before', 'second', () => second.promise, apply, onFailure);

    first.reject(new Error('timeout'));
    await expect(firstWrite).resolves.toBe(false);
    expect(displayed).toBe('second');
    expect(onFailure).not.toHaveBeenCalled();

    second.resolve('second');
    await expect(secondWrite).resolves.toBe(true);
    expect(displayed).toBe('second');
  });
});
