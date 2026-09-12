package com.kaizen.todo.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Persisted automation/reminder rule.
 *
 * trigger_type values: due-date | overdue | recurring | status-change | daily-digest
 * status values:       active | paused | draft
 * urgency values:      low | medium | high | critical
 */
@Entity
@Table(name = "automation_rules", indexes = {
        @Index(name = "idx_auto_rules_status", columnList = "status"),
        @Index(name = "idx_auto_rules_next",   columnList = "next_trigger_at")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AutomationRule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @NotBlank
    @Size(max = 200)
    @Column(nullable = false, length = 200)
    private String name;

    @Size(max = 1000)
    @Column(length = 1000)
    private String description;

    /** Optional linked task UUID (stored as string to avoid FK coupling). */
    @Column(name = "task_id")
    private UUID taskId;

    @Size(max = 500)
    @Column(name = "task_title", length = 500)
    private String taskTitle;

    @Column(name = "trigger_type", nullable = false, length = 30)
    @Builder.Default
    private String triggerType = "recurring";

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String status = "active";

    @Column(nullable = false, length = 20)
    @Builder.Default
    private String urgency = "medium";

    @Column(name = "notify_in_app", nullable = false)
    @Builder.Default
    private boolean notifyInApp = true;

    @Column(name = "notify_browser", nullable = false)
    @Builder.Default
    private boolean notifyBrowser = false;

    /**
     * JSON blob: { "value": 30, "unit": "minutes" }
     * Used for due-date trigger type.
     */
    @Size(max = 200)
    @Column(name = "reminder_offset_json", length = 200)
    private String reminderOffsetJson;

    /**
     * JSON blob: { "frequency": "daily", "time": "09:00", "dayOfWeek": null, "dayOfMonth": null }
     * Used for recurring / daily-digest trigger types.
     */
    @Column(name = "recurrence_json", columnDefinition = "TEXT")
    private String recurrenceJson;

    @Column(name = "last_triggered_at")
    private Instant lastTriggeredAt;

    @Column(name = "next_trigger_at")
    private Instant nextTriggerAt;

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
