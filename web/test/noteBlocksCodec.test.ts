import { describe, it, expect } from 'vitest';
import { COMPRESSED_PREFIX, decodeBlocksJson, encodeBlocksJson, syncedLength } from '@/lib/noteBlocksCodec';
import { NOTE_SYNC_LIMIT } from '@/types/notes';

const lines = ['"type": "SingleLine", "label": "Customer Remark",', '"api_name": "Customer_Remark",', '"length": 255,', '"required": false'];
const bigBlocks = () => Array.from({ length: 90 }, (_, i) => ({ id: crypto.randomUUID(), type: 'toggle', content: lines[i % 4], ...(i % 3 ? { indent: 1 } : {}) }));

describe('note blocks codec', () => {
  it('sends a note that fits exactly as it is, so older apps read it unchanged', async () => {
    const json = JSON.stringify([{ id: 'a', type: 'paragraph', content: 'hi' }]);
    expect(await encodeBlocksJson(json)).toBe(json);
    expect(await decodeBlocksJson(json)).toBe(json);
  });

  it('deflates a note over the limit and gets back exactly the same blocks', async () => {
    const blocks = bigBlocks();
    const json = JSON.stringify(blocks);
    expect(json.length).toBeGreaterThan(NOTE_SYNC_LIMIT);
    const sent = await encodeBlocksJson(json);
    expect(sent.startsWith(COMPRESSED_PREFIX)).toBe(true);
    expect(sent.length).toBeLessThan(NOTE_SYNC_LIMIT);
    expect(JSON.parse(await decodeBlocksJson(sent))).toEqual(blocks);
    expect(await syncedLength(json)).toBe(sent.length);
  });

  it('keeps non-ASCII text intact', async () => {
    const blocks = Array.from({ length: 300 }, (_, i) => ({ id: `id-${i}`, type: 'paragraph', content: `வணக்கம் ✓ 日本語 ${i}` }));
    const json = JSON.stringify(blocks);
    expect(JSON.parse(await decodeBlocksJson(await encodeBlocksJson(json)))).toEqual(blocks);
  });

  it('refuses damaged compressed text instead of returning something wrong', async () => {
    await expect(decodeBlocksJson(`${COMPRESSED_PREFIX}not-base64-!!`)).rejects.toThrow();
    await expect(decodeBlocksJson(`${COMPRESSED_PREFIX}AAAA`)).rejects.toThrow();
  });
});
