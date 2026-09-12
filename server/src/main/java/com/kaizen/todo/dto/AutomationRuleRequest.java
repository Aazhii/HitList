package com.kaizen.todo.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.UUID;

@Data
public class AutomationRuleRequest {

    @NotBlank
    @Size(max = 200)
    private String name;

    @Size(max = 1000)
    private String description;

    private UUID taskId;

    @Size(max = 500)
    private String taskTitle;

    /** due-date | overdue | recurring | status-change | daily-digest */
    private String triggerType = "recurring";

    /** active | paused | draft */
    private String status = "active";

    /** low | medium | high | critical */
    private String urgency = "medium";

    private boolean notifyInApp = true;
    private boolean notifyBrowser = false;

    /** JSON: { "value": 30, "unit": "minutes" } */
    private String reminderOffsetJson;

    /** JSON: { "frequency": "daily", "time": "09:00" } */
    private String recurrenceJson;
}
