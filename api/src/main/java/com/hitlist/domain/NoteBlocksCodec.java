package com.hitlist.domain;

import java.io.ByteArrayOutputStream;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.zip.DataFormatException;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/**
 * A note's blocks are stored as one string of at most {@link #LIMIT} characters. The app sends a note that is over
 * that as {@code z1:} + base64 of raw deflate (see web/src/lib/noteBlocksCodec.ts); one that fits stays plain JSON.
 * Code that has to read or rewrite the blocks goes through here so it sees plain JSON, and writes back in whichever
 * form fits.
 */
public final class NoteBlocksCodec {
    public static final int LIMIT = 10_000;
    public static final String PREFIX = "z1:";
    private static final int MAX_DECODED_BYTES = 6_000_000;

    private NoteBlocksCodec() { }

    /** The plain JSON behind a stored value; throws IllegalArgumentException when it is damaged. */
    public static String decode(String stored) {
        if (stored == null || !stored.startsWith(PREFIX)) return stored;
        Inflater inflater = new Inflater(true);
        try {
            inflater.setInput(Base64.getDecoder().decode(stored.substring(PREFIX.length())));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            while (!inflater.finished()) {
                int n = inflater.inflate(buffer);
                if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) throw new IllegalArgumentException("note content is incomplete");
                out.write(buffer, 0, n);
                if (out.size() > MAX_DECODED_BYTES) throw new IllegalArgumentException("note content is too large");
            }
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString();
        } catch (DataFormatException | CharacterCodingException error) {
            throw new IllegalArgumentException("note content is invalid", error);
        } finally {
            inflater.end();
        }
    }

    /** The value to store for these blocks: plain when it fits, deflated when that is what makes it fit. */
    public static String encode(String json) {
        if (json.length() <= LIMIT) return json;
        Deflater deflater = new Deflater(Deflater.BEST_COMPRESSION, true);
        try {
            deflater.setInput(json.getBytes(StandardCharsets.UTF_8));
            deflater.finish();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            while (!deflater.finished()) out.write(buffer, 0, deflater.deflate(buffer));
            String packed = PREFIX + Base64.getEncoder().encodeToString(out.toByteArray());
            return packed.length() < json.length() ? packed : json;
        } finally {
            deflater.end();
        }
    }
}
