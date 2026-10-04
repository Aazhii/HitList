const pending = new Set<Promise<unknown>>();
const hooks = new Set<() => Promise<void>>();
let failure: { error: unknown } | undefined;

export function trackPendingSave<Result>(operation: () => Promise<Result>): Promise<Result> {
  const promise = operation();
  pending.add(promise);
  return promise.then(
    result => { pending.delete(promise); return result; },
    error => { pending.delete(promise); failure = { error }; throw error; },
  );
}

export function onPreLogout(hook: () => Promise<void>): () => void {
  hooks.add(hook);
  return () => { hooks.delete(hook); };
}

export async function prepareForSignOut(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
  if (failure) throw failure.error;
  await Promise.all([...hooks].map(hook => hook()));
  while (pending.size) await Promise.allSettled([...pending]);
  if (failure) throw failure.error;
}