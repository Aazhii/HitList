import { describe, it, expect, vi, afterEach } from 'vitest';
import { notesSyncService } from '@/services/notesSyncService';
import { decodeBlocksJson } from '@/lib/noteBlocksCodec';

afterEach(() => vi.unstubAllGlobals());

describe('notes sync of a note over the size limit', () => {
  it('sends it deflated, and keeps the queued copy plain', async () => {
    const blocks = Array.from({ length: 120 }, (_, i) => ({ id: crypto.randomUUID(), type: 'toggle', content: `"api_name": "Field_${i % 4}",` }));
    const plain = JSON.stringify(blocks);
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) sent.push(String(init.body));
      return new Response('{}', { status: 200 });
    }));
    notesSyncService.queueUpsert({ id: 'big-note', title: 'Big', blocksJson: plain, updatedAt: 1 });
    await notesSyncService.flushNow();
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]) as { blocksJson: string };
    expect(body.blocksJson.length).toBeLessThan(10_000);
    expect(JSON.parse(await decodeBlocksJson(body.blocksJson))).toEqual(blocks);
  });
});
