const pending = new Set<Promise<unknown>>();
const hooks = new Set<() => Promise<void>>();
let failure: { error: unknown } | undefined;
// Failed saves that name the thing they were saving. A later successful save of the same thing clears the failure, so one
// failed write does not block signing out (or sharing) for the rest of the session once that edit has been saved after all.
const keyedFailures = new Map<string, unknown>();

export function trackPendingSave<Result>(operation: () => Promise<Result>, key?: string): Promise<Result> {
  const promise = operation();
  pending.add(promise);
  return promise.then(
    result => { pending.delete(promise); if (key) keyedFailures.delete(key); return result; },
    error => {
      pending.delete(promise);
      if (key) keyedFailures.set(key, error); else failure = { error };
      throw error;
    },
  );
}

const firstFailure = (): { error: unknown } | undefined => failure ?? (keyedFailures.size ? { error: [...keyedFailures.values()][0] } : undefined);

export function onPreLogout(hook: () => Promise<void>): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

export async function prepareForSignOut(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
  const first = firstFailure();
  if (first) throw first.error;
  await Promise.all([...hooks].map(hook => hook()));
  while (pending.size) await Promise.allSettled([...pending]);
  const last = firstFailure();
  if (last) throw last.error;
}