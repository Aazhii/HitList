package com.hitlist.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

class NoteBlocksCodecTest {
    // Produced by the app's codec (web/src/lib/noteBlocksCodec.ts) from PLAIN, so the two sides agree on the format.
    private static final String PLAIN = "[{\"id\":\"b0\",\"type\":\"toggle\",\"content\":\"வணக்கம் \\\"quoted\\\" ✓ 0\"},"
        + "{\"id\":\"b1\",\"type\":\"toggle\",\"content\":\"வணக்கம் \\\"quoted\\\" ✓ 1\"},"
        + "{\"id\":\"b2\",\"type\":\"toggle\",\"content\":\"வணக்கம் \\\"quoted\\\" ✓ 2\"}]";
    private static final String FROM_APP = "z1:i65WykxRslJKMlDSUSqpLEhVslIqyU9Pz0lV0lFKzs8rSc0rUbJSerBu64N1ix+sm/pgfS+IXLfuwfpehRilwtL8ktSUGCWFR3MmKxgo1erAjDOk3DhDJOOMKDfOSKk2FgA=";

    private static String big() {
        return "[" + IntStream.range(0, 120)
            .mapToObj(i -> "{\"id\":\"" + java.util.UUID.randomUUID() + "\",\"type\":\"toggle\",\"content\":\"\\\"api_name\\\": \\\"Field_" + (i % 4) + "\\\",\"}")
            .collect(Collectors.joining(",")) + "]";
    }

    @Test
    void readsWhatTheAppSends() {
        assertThat(NoteBlocksCodec.decode(FROM_APP)).isEqualTo(PLAIN);
    }

    @Test
    void leavesPlainJsonAlone() {
        assertThat(NoteBlocksCodec.decode(PLAIN)).isEqualTo(PLAIN);
        assertThat(NoteBlocksCodec.encode(PLAIN)).isEqualTo(PLAIN);
    }

    @Test
    void deflatesOnlyWhatIsOverTheLimitAndRoundTrips() {
        String json = big();
        assertThat(json.length()).isGreaterThan(NoteBlocksCodec.LIMIT);
        String stored = NoteBlocksCodec.encode(json);
        assertThat(stored).startsWith(NoteBlocksCodec.PREFIX);
        assertThat(stored.length()).isLessThanOrEqualTo(NoteBlocksCodec.LIMIT);
        assertThat(NoteBlocksCodec.decode(stored)).isEqualTo(json);
    }

    @Test
    void refusesDamagedContent() {
        assertThatThrownBy(() -> NoteBlocksCodec.decode("z1:not base64!")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> NoteBlocksCodec.decode("z1:AAAA")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> NoteBlocksCodec.decode(FROM_APP.substring(0, 40))).isInstanceOf(IllegalArgumentException.class);
    }
}
