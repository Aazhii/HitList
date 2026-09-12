package com.kaizen.todo.dto;

import com.kaizen.todo.model.Note;
import lombok.*;

/**
 * Outbound DTO for a Note.
 * Timestamps are returned as epoch-milliseconds to match the frontend Note type.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NoteResponse {

    private String id;
    private String title;
    private String blocksJson;
    private String emoji;
    private boolean pinned;
    private long createdAt;
    private long updatedAt;

    public static NoteResponse from(Note note) {
        return NoteResponse.builder()
                .id(note.getId().toString())
                .title(note.getTitle())
                .blocksJson(note.getBlocksJson())
                .emoji(note.getEmoji())
                .pinned(note.isPinned())
                .createdAt(note.getCreatedAt().toEpochMilli())
                .updatedAt(note.getUpdatedAt().toEpochMilli())
                .build();
    }
}
