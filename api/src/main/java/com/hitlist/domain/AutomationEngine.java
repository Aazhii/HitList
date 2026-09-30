package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.storage.StorageTables;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Decides which automation rules are due, and fires them.
 *
 * It runs from a sweep (see AutomationScheduler) while the app is open — nothing fires while it is
 * closed, and a firing whose moment passed more than {@link #GRACE_MS} ago is dropped rather than
 * delivered late. Each firing carries a key (rule, task, moment), stored on its run row, so a
 * sweep that sees the same moment twice delivers it once. A rule never fires for a moment before
 * it was created.
 *
 * Triggers: a task's due date with signed minute offsets; a recurring schedule; a daily digest; a
 * task changing status (found by comparing against the statuses seen at the last sweep, so the
 * first sweep only records them).
 */
@Service
public class AutomationEngine {
    private static final Logger LOG = LoggerFactory.getLogger(AutomationEngine.class);
    static final long GRACE_MS = 2 * 60 * 60 * 1000L;
    private static final TypeReference<LinkedHashMap<String, String>> STRING_MAP = new TypeReference<>() { };

    private final EntityRepository repository;
    private final ObjectMapper objectMapper;
    private final AutomationDelivery delivery;

    public AutomationEngine(EntityRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.delivery = new AutomationDelivery(repository, objectMapper);
    }

    /** One pass over every owner that has rules. A failure for one owner does not stop the rest. */
    public void sweep(long now) {
        for (String owner : repository.owners(StorageTables.RULES)) {
            try {
                sweepOwner(owner, now);
            } catch (RuntimeException exception) {
                LOG.warn("automation sweep failed for an owner: {}", exception.toString());
            }
        }
    }

    public void sweepOwner(String owner, long now) {
        List<Map<String, Object>> rules = repository.list(StorageTables.RULES, owner);
        if (rules.isEmpty()) return;
        List<Map<String, Object>> tasks = repository.list(StorageTables.TASKS, owner);
        Set<String> fired = new HashSet<>();
        for (Map<String, Object> run : repository.list(StorageTables.RUNS, owner)) {
            String key = EntityRepository.text(run.get("FireKey"));
            if (!key.isBlank()) fired.add(key);
        }
        for (Map<String, Object> rule : rules) {
            if (!"active".equals(EntityRepository.text(rule.get("RuleStatus")))) continue;
            try {
                sweepRule(owner, rule, tasks, fired, now);
            } catch (RuntimeException exception) {
                LOG.warn("automation rule {} failed: {}", EntityRepository.text(rule.get("RuleId")), exception.toString());
            }
        }
    }

    private void sweepRule(String owner, Map<String, Object> rule, List<Map<String, Object>> tasks, Set<String> fired, long now) {
        String type = EntityRepository.text(rule.get("TriggerType"));
        String ruleId = EntityRepository.text(rule.get("RuleId"));
        ZoneId zone = zone(rule);
        long floor = Math.max(Values.number(rule.get("CreatedAt"), 0), now - GRACE_MS);
        long next = 0;
        Map<String, String> seen = null;

        switch (type) {
            case "due-date", "overdue" -> {
                List<Long> offsets = offsets(rule);
                for (Map<String, Object> task : scope(rule, tasks)) {
                    if ("DONE".equals(EntityRepository.text(task.get("Status")))) continue;
                    long due = dueInstant(task, zone);
                    if (due < 0) continue;
                    for (long offset : offsets) {
                        long at = due + offset * 60_000L;
                        String key = ruleId + "|" + EntityRepository.text(task.get("TaskId")) + "|" + due + "|" + offset;
                        if (at > now) {
                            next = next == 0 ? at : Math.min(next, at);
                        } else if (at >= floor && fired.add(key)) {
                            String taskId = EntityRepository.text(task.get("TaskId"));
                            delivery.deliver(owner, rule, taskId, EntityRepository.text(task.get("Title")),
                                timing(offset) + " · " + EntityRepository.text(rule.get("Name")), "scheduler", key, now,
                                Map.of("dueAt", due, "minutesBefore", Math.max(0, -offset)));
                        }
                    }
                }
            }
            case "recurring", "daily-digest" -> {
                long at = occurrenceOn(rule, Instant.ofEpochMilli(now).atZone(zone).toLocalDate(), zone);
                String key = ruleId + "|" + Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
                if (at >= 0 && at <= now && at >= floor && fired.add(key)) {
                    boolean digest = "daily-digest".equals(type);
                    String title = digest ? "Daily digest" : EntityRepository.text(rule.get("Name"));
                    String taskId = EntityRepository.text(rule.get("TaskId"));
                    String body = digest ? digestText(tasks, zone, now) : "Recurring reminder";
                    delivery.deliver(owner, rule, taskId, title, body, "scheduler", key, now, Map.of());
                }
                next = nextOccurrence(rule, now, zone);
            }
            case "status-change" -> {
                seen = readSeen(rule);
                boolean first = seen.isEmpty();
                Map<String, String> current = new LinkedHashMap<>();
                for (Map<String, Object> task : scope(rule, tasks)) {
                    String taskId = EntityRepository.text(task.get("TaskId"));
                    String status = EntityRepository.text(task.get("Status"));
                    current.put(taskId, status);
                    String before = seen.get(taskId);
                    if (!first && before != null && !before.equals(status)) {
                        delivery.deliver(owner, rule, taskId, EntityRepository.text(task.get("Title")),
                            label(before) + " → " + label(status) + " · " + EntityRepository.text(rule.get("Name")),
                            "scheduler", "", now, Map.of());
                    }
                }
                seen = current;
            }
            default -> { }
        }

        // Only what changed is written back, from a fresh copy: delivery has just updated the rule.
        Map<String, Object> stored = repository.require(StorageTables.RULES, owner, ruleId);
        boolean dirty = false;
        if (Values.number(stored.get("NextTriggerAt"), 0) != next) { stored.put("NextTriggerAt", next); dirty = true; }
        if (seen != null && !seen.equals(readSeen(stored))) { stored.put("SeenStatuses", json(seen)); dirty = true; }
        if (dirty) repository.replace(StorageTables.RULES, owner, ruleId, stored);
    }

    // ── what a rule looks at ─────────────────────────────────────────────────

    private List<Map<String, Object>> scope(Map<String, Object> rule, List<Map<String, Object>> tasks) {
        String taskId = EntityRepository.text(rule.get("TaskId"));
        if (taskId.isBlank()) return tasks;
        return tasks.stream().filter((t) -> taskId.equals(EntityRepository.text(t.get("TaskId")))).toList();
    }

    private List<Long> offsets(Map<String, Object> rule) {
        List<Long> out = new ArrayList<>();
        for (Object step : Values.jsonList(objectMapper, rule.get("OffsetSteps"))) {
            if (step instanceof Number number) out.add(number.longValue());
        }
        if (out.isEmpty()) out.add(0L);
        return out;
    }

    private String digestText(List<Map<String, Object>> tasks, ZoneId zone, long now) {
        LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        int dueToday = 0;
        int overdue = 0;
        for (Map<String, Object> task : tasks) {
            if ("DONE".equals(EntityRepository.text(task.get("Status")))) continue;
            String date = EntityRepository.text(task.get("DueDate"));
            if (date.isBlank()) continue;
            LocalDate due = LocalDate.parse(date);
            if (due.equals(today)) dueToday++;
            else if (due.isBefore(today)) overdue++;
        }
        return dueToday + " due today · " + overdue + " overdue";
    }

    private static String label(String status) {
        return switch (status) {
            case "DONE" -> "Done";
            case "IN_PROGRESS" -> "In progress";
            default -> "To do";
        };
    }

    static String timing(long offsetMinutes) {
        if (offsetMinutes == 0) return "Due now";
        long abs = Math.abs(offsetMinutes);
        String amount = abs % 1440 == 0 ? abs / 1440 + (abs == 1440 ? " day" : " days")
            : abs % 60 == 0 ? abs / 60 + (abs == 60 ? " hour" : " hours")
            : abs + (abs == 1 ? " minute" : " minutes");
        return offsetMinutes < 0 ? "Due in " + amount : "Overdue by " + amount;
    }

    // ── time ─────────────────────────────────────────────────────────────────

    private ZoneId zone(Map<String, Object> rule) {
        String id = EntityRepository.text(rule.get("Timezone"));
        try {
            return id.isBlank() ? ZoneId.systemDefault() : ZoneId.of(id);
        } catch (RuntimeException exception) {
            return ZoneId.systemDefault();
        }
    }

    /** The due instant in epoch ms, or -1 with no due date. A date without a time is due at the end of that day. */
    static long dueInstant(Map<String, Object> task, ZoneId zone) {
        String date = EntityRepository.text(task.get("DueDate"));
        if (date.isBlank()) return -1;
        String time = EntityRepository.text(task.get("DueTime"));
        LocalTime at = time.isBlank() ? LocalTime.of(23, 59) : LocalTime.parse(time);
        return ZonedDateTime.of(LocalDate.parse(date), at, zone).toInstant().toEpochMilli();
    }

    /** When the rule's recurring schedule falls on `day`, in epoch ms; -1 when it does not run that day. */
    long occurrenceOn(Map<String, Object> rule, LocalDate day, ZoneId zone) {
        String time = EntityRepository.text(rule.get("RecurrenceTime"));
        if (time.isBlank()) return -1;
        String frequency = EntityRepository.text(rule.get("RecurrenceFreq"));
        boolean runs = switch (frequency) {
            case "weekdays" -> day.getDayOfWeek() != DayOfWeek.SATURDAY && day.getDayOfWeek() != DayOfWeek.SUNDAY;
            case "weekly" -> day.getDayOfWeek().getValue() % 7 == Values.number(rule.get("RecurrenceDayOfWeek"), 0);
            case "monthly" -> day.getDayOfMonth() == Math.min((int) Values.number(rule.get("RecurrenceDayOfMonth"), 1), day.lengthOfMonth());
            default -> true;
        };
        if (!runs) return -1;
        return ZonedDateTime.of(day, LocalTime.parse(time), zone).toInstant().toEpochMilli();
    }

    long nextOccurrence(Map<String, Object> rule, long now, ZoneId zone) {
        LocalDate day = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        for (int i = 0; i < 62; i++) {
            long at = occurrenceOn(rule, day.plusDays(i), zone);
            if (at > now) return at;
        }
        return 0;
    }

    private Map<String, String> readSeen(Map<String, Object> rule) {
        String raw = EntityRepository.text(rule.get("SeenStatuses"));
        if (raw.isBlank()) return new LinkedHashMap<>();
        try {
            return objectMapper.readValue(raw, STRING_MAP);
        } catch (JsonProcessingException exception) {
            return new LinkedHashMap<>();
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            return "{}";
        }
    }
}
