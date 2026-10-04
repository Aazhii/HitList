import { onPreLogout, trackPendingSave } from './preLogout';

const barriers = new Set<() => Promise<void>>();
const writes = new Set<Promise<unknown>>();
let failed = false;
let version = 0;

export function onSourceSave(barrier: () => Promise<void>): () => void {
  barriers.add(barrier);
  return () => { barriers.delete(barrier); };
}

export function trackSourceWrite<T>(write: Promise<T>): Promise<T> {
  version++;
  const tracked = trackPendingSave(() => write);
  writes.add(tracked);
  void tracked.then(() => writes.delete(tracked), () => { writes.delete(tracked); failed = true; });
  return tracked;
}

export async function waitForSourceWrites(): Promise<void> {
  while (writes.size) await Promise.allSettled([...writes]);
}

export async function flushSourceSaves(): Promise<void> {
  for (const barrier of barriers) await barrier();
  await waitForSourceWrites();
  if (failed) {
    throw new Error('A source edit could not be saved. Review it before sharing or switching workspace.');
  }
}

onPreLogout(flushSourceSaves);

export const sourceWritesPending = () => writes.size > 0;
export const sourceWriteVersion = () => version;