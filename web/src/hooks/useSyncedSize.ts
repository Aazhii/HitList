import { useEffect, useState } from 'react';
import { NOTE_SYNC_LIMIT } from '@/types/notes';
import { syncedLength } from '@/lib/noteBlocksCodec';

/**
 * How many characters a note sends to the server. Under the limit that is the JSON itself; past it the note is
 * sent deflated, so the count that matters is the deflated one, worked out off the render. Until it is known `size`
 * is 0 and `packed` false (no "too long" alert is raised on a guess).
 */
export function useSyncedSize(plainJson: string): { size: number; packed: boolean } {
  const [known, setKnown] = useState<{ json: string; size: number } | null>(null);
  useEffect(() => {
    if (plainJson.length <= NOTE_SYNC_LIMIT) return;
    let live = true;
    void syncedLength(plainJson).then((size) => { if (live) setKnown({ json: plainJson, size }); }).catch(() => {});
    return () => { live = false; };
  }, [plainJson]);
  if (plainJson.length <= NOTE_SYNC_LIMIT) return { size: plainJson.length, packed: false };
  return known?.json === plainJson ? { size: known.size, packed: true } : { size: 0, packed: false };
}
