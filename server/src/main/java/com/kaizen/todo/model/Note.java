package com.kaizen.todo.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Persistent note entity for the Kaizen Notes workspace.
 *
 * blocks is stored as a JSON string (TEXT column) and serialised/
 * deserialised by the service layer so the frontend NoteBlock[]
 * structure is preserved exactly.
 */
@Entity
@Table(name = "notes", indexes = {
        @Index(name = "idx_notes_updated_at", columnList = "updated_at"),
        @Index(name = "idx_notes_pinned",     columnList = "pinned")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Note {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @NotBlank(message = "Title must not be blank")
    @Size(max = 500)
    @Column(nullable = false, length = 500)
    private String title;

    /**
     * JSON-serialised NoteBlock[] array.
     * Stored as TEXT so arbitrary block structures are preserved.
     */
    @Column(name = "blocks_json", columnDefinition = "TEXT")
    private String blocksJson;

    /** Single emoji character chosen by the user. */
    @Size(max = 10)
    @Column(length = 10)
    private String emoji;

    @Column(nullable = false)
    @Builder.Default
    private boolean pinned = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
