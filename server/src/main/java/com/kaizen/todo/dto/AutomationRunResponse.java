package com.kaizen.todo.dto;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

@Data
@Builder
public class AutomationRunResponse {
    private UUID id;
    private UUID ruleId;
    private String ruleName;
    private Instant triggeredAt;
    /** success | skipped | error */
    private String status;
    private String message;
    /** scheduler | manual */
    private String triggerSource;
}
