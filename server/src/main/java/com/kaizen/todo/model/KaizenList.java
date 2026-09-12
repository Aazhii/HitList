package com.kaizen.todo.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Workspace list entity — mirrors the frontend {@code KaizenList} type.
 *
 * A list groups tasks and has a display color token.
 * The frontend uses string IDs; here we use UUID primary keys.
 */
@Entity
@Table(name = "kaizen_lists")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KaizenList {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    /** Display name of the list. Required, max 100 chars. */
    @NotBlank(message = "List name must not be blank")
    @Size(max = 100, message = "List name must be 100 characters or fewer")
    @Column(nullable = false, length = 100)
    private String name;

    /**
     * Tailwind color token key (e.g. "emerald", "blue", "rose").
     * Mirrors the frontend LIST_COLORS id values.
     */
    @Size(max = 30)
    @Column(length = 30)
    @Builder.Default
    private String color = "emerald";

    /**
     * Display order for sidebar sorting.
     * Lower values appear first.
     */
    @Column(name = "list_order", nullable = false)
    @Builder.Default
    private int listOrder = 0;

    /** When the list was created. Set once on persist. */
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** When the list was last modified. */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
