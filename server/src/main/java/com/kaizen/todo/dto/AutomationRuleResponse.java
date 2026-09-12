package com.kaizen.todo.dto;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

@Data
@Builder
public class AutomationRuleResponse {
    private UUID id;
    private String name;
    private String description;
    private UUID taskId;
    private String taskTitle;
    private String triggerType;
    private String status;
    private String urgency;
    private boolean notifyInApp;
    private boolean notifyBrowser;
    private String reminderOffsetJson;
    private String recurrenceJson;
    private Instant lastTriggeredAt;
    private Instant nextTriggerAt;
    private Instant createdAt;
    private Instant updatedAt;
}
