/**
 * Where a signed-in user's notes live in localStorage.
 *
 * Notes used one key for every account, and useNotes pushes every local note to
 * whoever is signed in — so two accounts on one browser would send each other
 * their notes. Tasks already had a per-user key (lib/storage.ts); notes now do
 * too.
 */
import { NOTES_STORAGE_KEY, type Note } from '@/types/notes';

export function notesStorageKey(userId: string | null): string {
  return userId ? `${NOTES_STORAGE_KEY}-${userId}` : NOTES_STORAGE_KEY;
}

function parseNotes(raw: string | null): Note[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Note[]) : null;
  } catch {
    return null;
  }
}

/**
 * Moves notes saved under the old shared key into the signed-in user's key.
 *
 * Nothing is removed until it has been written somewhere else, and nothing
 * already under the user's key is overwritten: the two sets are merged by note
 * id, keeping whichever copy was edited last. Unreadable data is left exactly
 * where it is. The first account to sign in on this browser after the change
 * receives the shared notes; any server copy stays with the account that wrote it.
 */
export function claimLegacyNotes(storage: Storage, userId: string | null): void {
  if (!userId) return;

  const legacyRaw = storage.getItem(NOTES_STORAGE_KEY);
  const legacy = parseNotes(legacyRaw);
  if (legacy === null) return;

  const key = notesStorageKey(userId);
  const ownRaw = storage.getItem(key);
  const own = parseNotes(ownRaw);
  if (ownRaw !== null && own === null) return;

  const merged = new Map<string, Note>();
  for (const note of [...(own ?? []), ...legacy]) {
    const current = merged.get(note.id);
    if (!current || (note.updatedAt ?? 0) > (current.updatedAt ?? 0)) merged.set(note.id, note);
  }

  storage.setItem(key, JSON.stringify([...merged.values()]));
  storage.removeItem(NOTES_STORAGE_KEY);
}
