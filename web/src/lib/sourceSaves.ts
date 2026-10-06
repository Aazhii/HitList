import { onPreLogout, trackPendingSave } from './preLogout';

const barriers = new Set<() => Promise<void>>();
const writes = new Set<Promise<unknown>>();
// Writes that failed, by what they were writing. A later successful write of the same thing clears its entry, so a failed
// write is reported until that edit has been saved after all, not for the rest of the session.
const failures = new Map<string, string>();
let version = 0;

export function onSourceSave(barrier: () => Promise<void>): () => void {
  barriers.add(barrier);
  return () => { barriers.delete(barrier); };
}

/** `key` names what is being written (for example the request path); a write without one stays a failure until restart. */
export function trackSourceWrite<T>(write: Promise<T>, key?: string): Promise<T> {
  version++;
  const mine = version;
  const tracked = trackPendingSave(() => write, key);
  writes.add(tracked);
  void tracked.then(
    () => { writes.delete(tracked); if (key) failures.delete(key); },
    () => { writes.delete(tracked); failures.set(key ?? `#${mine}`, key ?? 'a source edit'); },
  );
  return tracked;
}

export async function waitForSourceWrites(): Promise<void> {
  while (writes.size) await Promise.allSettled([...writes]);
}

/**
 * Saves what is open and waits for every write in flight. It then refuses (so nothing is shared or switched on top of a lost
 * edit) if a write failed and has not been saved since. A task made from a note only depends on the note, so it passes
 * `{ ignoreFailedWrites: true }`: an unrelated failed database edit must not stop it.
 */
export async function flushSourceSaves(options: { ignoreFailedWrites?: boolean } = {}): Promise<void> {
  for (const barrier of barriers) await barrier();
  await waitForSourceWrites();
  if (failures.size && !options.ignoreFailedWrites) {
    const what = [...new Set(failures.values())].slice(0, 3).join(', ');
    throw new Error(`A source edit could not be saved. Review it before sharing or switching workspace. (${what})`);
  }
}

onPreLogout(flushSourceSaves);

export const sourceWritesPending = () => writes.size > 0;
export const sourceWriteVersion = () => version;