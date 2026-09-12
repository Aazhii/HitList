package com.kaizen.todo.dto;

import jakarta.validation.constraints.Size;
import lombok.*;

/**
 * Inbound DTO for creating or updating a Note.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NoteRequest {

    @Size(min = 0, max = 500, message = "Title must be 500 characters or fewer")
    private String title;

    /** JSON-serialised NoteBlock[] — stored verbatim in the TEXT column. */
    private String blocksJson;

    @Size(max = 10)
    private String emoji;

    private Boolean pinned;

    /**
     * Client-side epoch-ms timestamps.
     * Stored as longs so the frontend Note shape is round-tripped exactly.
     */
    private Long createdAt;
    private Long updatedAt;
}
