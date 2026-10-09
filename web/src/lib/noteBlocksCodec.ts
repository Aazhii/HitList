/**
 * How a note's blocks travel to and from the server.
 *
 * A note is stored as one string, and the server refuses more than NOTE_SYNC_LIMIT characters of it. The JSON of
 * many short lines is mostly overhead (a 36-character id and key names per line, every quote escaped), so a note
 * past the limit is sent deflated: `z1:` + base64 of raw deflate. Anything that fits is still sent as plain JSON,
 * exactly as before, so an older HitList keeps reading every note it could already read. Compression is only on
 * the wire and in the server's row; the copy on this computer is always the plain blocks.
 *
 * The server has the same two functions (NoteBlocksCodec.java) for the places it reads a note's blocks.
 */
import { NOTE_SYNC_LIMIT } from '@/types/notes';

export const COMPRESSED_PREFIX = 'z1:';
/** Longest text a compressed note may expand to; a guard against a hostile or corrupt payload. */
const MAX_DECODED_CHARS = 2_000_000;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, maxBytes: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as BufferSource).then(() => writer.close()).catch(() => { /* the reader reports it */ });
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error('Note is too large to open'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function isCompressed(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(COMPRESSED_PREFIX);
}

/** The string to send for a note's blocks JSON: unchanged when it fits, deflated when it does not. */
export async function encodeBlocksJson(json: string): Promise<string> {
  if (json.length <= NOTE_SYNC_LIMIT || typeof CompressionStream === 'undefined') return json;
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'), json.length * 4 + 1024);
  const encoded = COMPRESSED_PREFIX + toBase64(packed);
  // Never swap in something longer than what we had.
  return encoded.length < json.length ? encoded : json;
}

/** The blocks JSON text behind a stored note string, plain or deflated. Throws when it cannot be read. */
export async function decodeBlocksJson(stored: string): Promise<string> {
  if (!stored.startsWith(COMPRESSED_PREFIX)) return stored;
  if (typeof DecompressionStream === 'undefined') throw new Error('This device cannot open a compressed note');
  const bytes = await pipe(fromBase64(stored.slice(COMPRESSED_PREFIX.length)), new DecompressionStream('deflate-raw'), MAX_DECODED_CHARS * 3);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** How many characters the server will be sent for these blocks. */
export async function syncedLength(json: string): Promise<number> {
  return (await encodeBlocksJson(json)).length;
}
