package com.kaizen.todo.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Core task entity for the Kaizen Todo App.
 *
 * Maps to the frontend {@code Todo} type in src/types/todo.ts:
 *   title               <- text
 *   status              <- status (TODO / IN_PROGRESS / DONE)
 *   quadrant            <- quadrant (DO / SCHEDULE / DELEGATE / ELIMINATE)
 *   note                <- note
 *   dueDate             <- dueDate (ISO date YYYY-MM-DD)
 *   dueTime             <- dueTime (HH:MM 24h)
 *   completedAt         <- completedAt (epoch ms on frontend, Instant here)
 *   createdAt           <- createdAt
 *   category            <- category
 *   listId              <- listId (UUID of parent KaizenList)
 *   taskOrder           <- order (int, position within list/quadrant)
 *   reminderEnabled     <- reminderEnabled
 *   reminderMinutesBefore <- reminderMinutesBefore (5/15/30/60)
 */
@Entity
@Table(name = "tasks", indexes = {
        @Index(name = "idx_tasks_list_id",    columnList = "list_id"),
        @Index(name = "idx_tasks_status",     columnList = "status"),
        @Index(name = "idx_tasks_quadrant",   columnList = "quadrant"),
        @Index(name = "idx_tasks_completed_at", columnList = "completed_at"),
        @Index(name = "idx_tasks_due_date",   columnList = "due_date")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    /** Main task title — required, max 500 chars. */
    @NotBlank(message = "Title must not be blank")
    @Size(max = 500, message = "Title must be 500 characters or fewer")
    @Column(nullable = false, length = 500)
    private String title;

    /** Workflow status. Defaults to TODO on creation. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private TaskStatus status = TaskStatus.TODO;

    /** Eisenhower Matrix quadrant. Defaults to DO. */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    @Builder.Default
    private Quadrant quadrant = Quadrant.DO;

    /** Optional priority level. */
    @Enumerated(EnumType.STRING)
    @Column(length = 10)
    private Priority priority;

    /** Optional free-text note / description. */
    @Size(max = 2000, message = "Note must be 2000 characters or fewer")
    @Column(length = 2000)
    private String note;

    /** Optional due date (date only, no time). */
    @Column(name = "due_date")
    private LocalDate dueDate;

    /** Optional due time stored as HH:MM string (mirrors frontend dueTime). */
    @Size(max = 5)
    @Column(name = "due_time", length = 5)
    private String dueTime;

    /** Free-text category label (personal / work / health / learning / creative). */
    @Size(max = 100)
    @Column(length = 100)
    private String category;

    /**
     * Foreign key to the parent KaizenList.
     * Nullable so tasks can exist without a list (future-proof).
     */
    @Column(name = "list_id")
    private UUID listId;

    /**
     * Display order within the list/quadrant.
     * Lower values appear first. Defaults to 0.
     */
    @Column(name = "task_order", nullable = false)
    @Builder.Default
    private int taskOrder = 0;

    /**
     * Whether a reminder is active for this task.
     * Mirrors frontend reminderEnabled.
     */
    @Column(name = "reminder_enabled", nullable = false)
    @Builder.Default
    private boolean reminderEnabled = false;

    /**
     * Minutes before due time to fire the reminder.
     * Accepted values: 5, 15, 30, 60. Null when reminder is disabled.
     */
    @Column(name = "reminder_minutes_before")
    private Integer reminderMinutesBefore;

    /**
     * Timestamp when the task was marked DONE.
     * Null while the task is not yet complete.
     */
    @Column(name = "completed_at")
    private Instant completedAt;

    /** Timestamp when the task was first created. Set once on persist. */
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** Timestamp of the last update. Refreshed on every merge. */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
        if (status == null) status = TaskStatus.TODO;
        if (quadrant == null) quadrant = Quadrant.DO;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
