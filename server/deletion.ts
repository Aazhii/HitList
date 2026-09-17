/**
 * A negative update time is an internal, durable deletion tombstone. Normal
 * writes always use Date.now(), so it needs no schema migration and works for
 * both Catalyst rows and the local PostgreSQL facade.
 */
export const DELETION_PENDING_UPDATED_AT = -1;

export function isDeletionPending(record: Pick<{ updatedAt: number }, 'updatedAt'>): boolean {
  return record.updatedAt === DELETION_PENDING_UPDATED_AT;
}

const tails = new Map<string, Promise<void>>();

/**
 * Serializes mutations of one durable entity within this server process. The
 * tombstone remains the cross-restart recovery record; this lock closes the
 * stale-read/write window between concurrent requests in a running instance.
 */
export async function withDeletionLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
  }
}

/** Acquires entity locks in a stable order, avoiding cross-request deadlocks. */
export async function withDeletionLocks<T>(keys: readonly string[], operation: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  const acquire = async (index: number): Promise<T> => (
    index === ordered.length
      ? operation()
      : withDeletionLock(ordered[index], () => acquire(index + 1))
  );
  return acquire(0);
}

export function deletionLockKey(kind: string, ownerId: string, id: string): string {
  return `${kind}:${ownerId}:${id}`;
}
