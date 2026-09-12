package com.kaizen.todo.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Daily momentum analytics snapshot.
 *
 * One row per calendar day per list (listId nullable = global).
 * Mirrors the frontend KaizenStats shape:
 *   streak          — consecutive days with ≥1 completion
 *   totalCompleted  — all-time completions for this list
 *   todayCompleted  — completions on snapshotDate
 */
@Entity
@Table(name = "momentum_snapshots", indexes = {
        @Index(name = "idx_snap_date",    columnList = "snapshot_date"),
        @Index(name = "idx_snap_list",    columnList = "list_id"),
        @Index(name = "idx_snap_date_list", columnList = "snapshot_date, list_id", unique = true)
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MomentumSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    /** The calendar day this snapshot covers. */
    @Column(name = "snapshot_date", nullable = false)
    private LocalDate snapshotDate;

    /**
     * List this snapshot belongs to.
     * Null = global (across all lists).
     */
    @Column(name = "list_id")
    private UUID listId;

    /** Consecutive-day streak at end of snapshotDate. */
    @Column(nullable = false)
    @Builder.Default
    private int streak = 0;

    /** All-time total completions for this list up to snapshotDate. */
    @Column(name = "total_completed", nullable = false)
    @Builder.Default
    private int totalCompleted = 0;

    /** Tasks completed on snapshotDate. */
    @Column(name = "today_completed", nullable = false)
    @Builder.Default
    private int todayCompleted = 0;

    /** When this snapshot row was written/updated. */
    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    @PrePersist
    @PreUpdate
    void stamp() {
        recordedAt = Instant.now();
    }
}
