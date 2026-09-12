package com.kaizen.todo.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Execution log entry for a single automation rule fire.
 *
 * status values:         success | skipped | error
 * trigger_source values: scheduler | manual
 */
@Entity
@Table(name = "automation_runs", indexes = {
        @Index(name = "idx_auto_runs_rule_id",      columnList = "rule_id"),
        @Index(name = "idx_auto_runs_triggered_at", columnList = "triggered_at")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AutomationRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @NotNull
    @Column(name = "rule_id", nullable = false)
    private UUID ruleId;

    @Size(max = 200)
    @Column(name = "rule_name", nullable = false, length = 200)
    private String ruleName;

    @Column(name = "triggered_at", nullable = false)
    private Instant triggeredAt;

    /** success | skipped | error */
    @Column(nullable = false, length = 20)
    @Builder.Default
    private String status = "success";

    @Size(max = 1000)
    @Column(length = 1000)
    private String message;

    /** scheduler | manual */
    @Column(name = "trigger_source", nullable = false, length = 30)
    @Builder.Default
    private String triggerSource = "scheduler";
}
