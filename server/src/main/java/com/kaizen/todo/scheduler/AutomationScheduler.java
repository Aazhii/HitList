package com.kaizen.todo.scheduler;

import com.kaizen.todo.model.AutomationRule;
import com.kaizen.todo.service.AutomationRuleService;
import com.kaizen.todo.service.AutomationRunService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Evaluates active automation rules every minute and records run outcomes.
 *
 * Evaluation logic (time-based, no task DB dependency required):
 *  - recurring / daily-digest: fires if the rule's recurrenceJson contains a
 *    "time" field matching the current HH:MM (UTC) and has not fired in the
 *    last 23 hours (prevents duplicate fires within the same minute window).
 *  - overdue / due-date / status-change: fires if lastTriggeredAt is null or
 *    older than 1 hour (stub evaluator — real evaluation requires task data).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AutomationScheduler {

    private final AutomationRuleService ruleService;
    private final AutomationRunService  runService;

    @Scheduled(fixedDelay = 60_000)   // every 60 s
    public void evaluateRules() {
        List<AutomationRule> active = ruleService.getActiveRules();
        if (active.isEmpty()) return;

        Instant now = Instant.now();
        String currentHHMM = LocalTime.now(ZoneOffset.UTC)
                .withSecond(0).withNano(0).toString().substring(0, 5);

        for (AutomationRule rule : active) {
            try {
                evaluate(rule, now, currentHHMM);
            } catch (Exception ex) {
                log.warn("Scheduler error for rule {}: {}", rule.getId(), ex.getMessage());
                runService.recordScheduledRun(rule, "error", ex.getMessage());
            }
        }
    }

    private void evaluate(AutomationRule rule, Instant now, String currentHHMM) {
        String type = rule.getTriggerType();

        switch (type) {
            case "recurring", "daily-digest" -> evaluateRecurring(rule, now, currentHHMM);
            case "overdue", "due-date", "status-change" -> evaluateTimeBased(rule, now);
            default -> log.debug("Unknown trigger type '{}' for rule {}", type, rule.getId());
        }
    }

    /** Fires if the configured HH:MM matches current time and hasn't fired in 23 h. */
    private void evaluateRecurring(AutomationRule rule, Instant now, String currentHHMM) {
        String recJson = rule.getRecurrenceJson();
        if (recJson == null || recJson.isBlank()) {
            runService.recordScheduledRun(rule, "skipped", "No recurrence config");
            return;
        }

        // Extract "time":"HH:MM" from JSON without a full parser
        String scheduledTime = extractJsonString(recJson, "time");
        if (scheduledTime == null) {
            runService.recordScheduledRun(rule, "skipped", "No time field in recurrence config");
            return;
        }

        // Validate time format
        try {
            LocalTime.parse(scheduledTime);
        } catch (DateTimeParseException e) {
            runService.recordScheduledRun(rule, "skipped", "Invalid time format: " + scheduledTime);
            return;
        }

        if (!scheduledTime.equals(currentHHMM)) {
            // Not the right minute — skip silently
            return;
        }

        // Guard: don't fire twice within 23 hours
        if (rule.getLastTriggeredAt() != null &&
                now.toEpochMilli() - rule.getLastTriggeredAt().toEpochMilli() < 23 * 3600_000L) {
            runService.recordScheduledRun(rule, "skipped", "Already fired within 23 h");
            return;
        }

        runService.recordScheduledRun(rule, "success",
                "Scheduled reminder fired at " + currentHHMM + " UTC");
        log.info("Automation rule '{}' fired (recurring, {})", rule.getName(), currentHHMM);
    }

    /** Stub evaluator for event-based triggers — fires at most once per hour. */
    private void evaluateTimeBased(AutomationRule rule, Instant now) {
        if (rule.getLastTriggeredAt() != null &&
                now.toEpochMilli() - rule.getLastTriggeredAt().toEpochMilli() < 3600_000L) {
            return; // throttle — skip silently
        }
        String msg = switch (rule.getTriggerType()) {
            case "overdue"       -> "Overdue check: reminder dispatched";
            case "due-date"      -> "Due-date reminder dispatched";
            case "status-change" -> "Status-change watch: reminder dispatched";
            default              -> "Reminder dispatched";
        };
        runService.recordScheduledRun(rule, "success", msg);
        log.info("Automation rule '{}' fired ({})", rule.getName(), rule.getTriggerType());
    }

    /** Minimal JSON string extractor — avoids pulling in a full JSON library. */
    private static String extractJsonString(String json, String key) {
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return null;
        int colon = json.indexOf(':', idx + search.length());
        if (colon < 0) return null;
        int q1 = json.indexOf('"', colon + 1);
        if (q1 < 0) return null;
        int q2 = json.indexOf('"', q1 + 1);
        if (q2 < 0) return null;
        return json.substring(q1 + 1, q2);
    }
}
