package com.hitlist;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.domain.AutomationEngine;
import com.hitlist.domain.EntityRepository;
import com.hitlist.domain.WorkspaceService;
import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** When rules fire: once, at the right moment, never early, never late, never for a done task. */
class AutomationEngineTest {
    private static final String OWNER = "owner-1";
    private static final long MIN = 60_000L;

    private EntityRepository repository;
    private WorkspaceService workspace;
    private AutomationEngine engine;

    @BeforeEach
    void setUp() {
        repository = new EntityRepository(new MemoryStore());
        ObjectMapper mapper = new ObjectMapper();
        workspace = new WorkspaceService(repository, mapper);
        engine = new AutomationEngine(repository, mapper);
    }

    private static long utc(String iso) {
        return LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli();
    }

    private void task(String id, String date, String time, String status) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("TaskId", id);
        row.put("Title", "Task " + id);
        row.put("Status", status);
        row.put("DueDate", date);
        row.put("DueTime", time);
        repository.insert(StorageTables.TASKS, OWNER, row);
    }

    private String rule(Map<String, Object> over) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Nudge");
        body.put("triggerType", "due-date");
        body.put("status", "active");
        body.put("notifyInApp", true);
        body.put("timezone", "UTC");
        body.putAll(over);
        return String.valueOf(workspace.createRule(OWNER, body).get("id"));
    }

    private int notifications() {
        return repository.list(StorageTables.NOTIFICATIONS, OWNER).size();
    }

    private int runs() {
        return repository.list(StorageTables.RUNS, OWNER).size();
    }

    @Test
    void aDueDateOffsetFiresOnceWhenItsMomentArrives() {
        task("t1", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(-30)));

        engine.sweepOwner(OWNER, utc("2030-01-02T08:20:00"));
        assertEquals(0, notifications(), "not yet");

        engine.sweepOwner(OWNER, utc("2030-01-02T08:31:00"));
        assertEquals(1, notifications());
        assertEquals(1, runs());
        Map<String, Object> note = repository.list(StorageTables.NOTIFICATIONS, OWNER).get(0);
        assertEquals("Task t1", note.get("Title"));
        assertTrue(String.valueOf(note.get("Body")).startsWith("Due in 30 minutes"));

        engine.sweepOwner(OWNER, utc("2030-01-02T08:32:00"));
        assertEquals(1, notifications(), "the same moment is not delivered twice");
    }

    @Test
    void severalStepsFireInOrder() {
        task("t1", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(-60, 0, 15)));
        engine.sweepOwner(OWNER, utc("2030-01-02T08:00:30"));
        engine.sweepOwner(OWNER, utc("2030-01-02T09:00:30"));
        engine.sweepOwner(OWNER, utc("2030-01-02T09:15:30"));
        assertEquals(3, notifications());
    }

    @Test
    void aMomentTooFarBehindIsDroppedNotDeliveredLate() {
        task("t1", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(0)));
        engine.sweepOwner(OWNER, utc("2030-01-02T14:00:00"));
        assertEquals(0, notifications());
    }

    @Test
    void aRuleNeverFiresForAMomentBeforeItExisted() {
        long created = System.currentTimeMillis();
        rule(Map.of("offsetMinutes", List.of(0)));
        // Due ten minutes before the rule was made, swept twenty minutes after: inside the grace window, but earlier than the rule.
        long due = created - 10 * MIN;
        java.time.ZonedDateTime z = java.time.Instant.ofEpochMilli(due).atZone(ZoneOffset.UTC);
        task("t1", z.toLocalDate().toString(), z.toLocalTime().withSecond(0).withNano(0).toString(), "TODO");
        engine.sweepOwner(OWNER, created + 20 * MIN);
        assertEquals(0, notifications());
    }

    @Test
    void aDoneTaskAndAPausedRuleStaySilent() {
        task("t1", "2030-01-02", "09:00", "DONE");
        rule(Map.of("offsetMinutes", List.of(0)));
        task("t2", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(0), "status", "paused", "taskId", "t2"));
        engine.sweepOwner(OWNER, utc("2030-01-02T09:01:00"));
        // The first rule covers every task: only t2 (open) fires for it; the paused one does nothing.
        assertEquals(1, notifications());
        assertEquals("Task t2", repository.list(StorageTables.NOTIFICATIONS, OWNER).get(0).get("Title"));
    }

    @Test
    void aDailyScheduleFiresOncePerDay() {
        String id = rule(Map.of("triggerType", "recurring", "name", "Stand-up",
            "recurrence", Map.of("frequency", "daily", "time", "09:00")));
        long created = Long.parseLong(String.valueOf(repository.require(StorageTables.RULES, OWNER, id).get("CreatedAt")));
        // Any 09:00 after the rule exists: use tomorrow so the creation floor is behind us.
        java.time.LocalDate tomorrow = java.time.Instant.ofEpochMilli(created).atZone(ZoneOffset.UTC).toLocalDate().plusDays(1);
        long nine = tomorrow.atTime(9, 0).toInstant(ZoneOffset.UTC).toEpochMilli();
        engine.sweepOwner(OWNER, nine - 5 * MIN);
        assertEquals(0, notifications());
        engine.sweepOwner(OWNER, nine + MIN);
        engine.sweepOwner(OWNER, nine + 2 * MIN);
        assertEquals(1, notifications());
        engine.sweepOwner(OWNER, nine + 24 * 60 * MIN + MIN);
        assertEquals(2, notifications());
    }

    @Test
    void weekdaysSkipTheWeekend() {
        String id = rule(Map.of("triggerType", "recurring", "recurrence", Map.of("frequency", "weekdays", "time", "09:00")));
        long created = Long.parseLong(String.valueOf(repository.require(StorageTables.RULES, OWNER, id).get("CreatedAt")));
        java.time.LocalDate day = java.time.Instant.ofEpochMilli(created).atZone(ZoneOffset.UTC).toLocalDate().plusDays(1);
        while (day.getDayOfWeek() != java.time.DayOfWeek.SATURDAY) day = day.plusDays(1);
        engine.sweepOwner(OWNER, day.atTime(9, 1).toInstant(ZoneOffset.UTC).toEpochMilli());
        assertEquals(0, notifications());
        engine.sweepOwner(OWNER, day.plusDays(2).atTime(9, 1).toInstant(ZoneOffset.UTC).toEpochMilli());
        assertEquals(1, notifications());
    }

    @Test
    void aStatusChangeFiresOnceAndTheFirstSweepOnlyRecords() {
        task("t1", "", "", "TODO");
        rule(Map.of("triggerType", "status-change", "taskId", "t1", "name", "Watch"));
        long now = System.currentTimeMillis();
        engine.sweepOwner(OWNER, now);
        assertEquals(0, notifications(), "the first sweep only records what it sees");

        Map<String, Object> row = repository.require(StorageTables.TASKS, OWNER, "t1");
        row.put("Status", "DONE");
        repository.replace(StorageTables.TASKS, OWNER, "t1", row);
        engine.sweepOwner(OWNER, now + 30_000);
        assertEquals(1, notifications());
        assertTrue(String.valueOf(repository.list(StorageTables.NOTIFICATIONS, OWNER).get(0).get("Body")).startsWith("To do → Done"));

        engine.sweepOwner(OWNER, now + 60_000);
        assertEquals(1, notifications());
    }

    @Test
    void emailAloneIsRecordedAsSkippedNotSent() {
        task("t1", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(0), "notifyInApp", false, "notifyEmail", true));
        engine.sweepOwner(OWNER, utc("2030-01-02T09:01:00"));
        assertEquals(0, notifications());
        Map<String, Object> run = repository.list(StorageTables.RUNS, OWNER).get(0);
        assertEquals("SKIPPED", run.get("RunStatus"));
        assertTrue(String.valueOf(run.get("Detail")).contains("email is not configured"));
    }

    @Test
    void theNextMomentIsRemembered() {
        task("t1", "2030-01-02", "09:00", "TODO");
        String id = rule(Map.of("offsetMinutes", List.of(-30)));
        engine.sweepOwner(OWNER, utc("2030-01-02T08:00:00"));
        assertEquals(utc("2030-01-02T08:30:00"), Long.parseLong(String.valueOf(repository.require(StorageTables.RULES, OWNER, id).get("NextTriggerAt"))));
    }

    @Test
    void runNowDeliversAtOnceAndIsRecordedAsManual() {
        task("t1", "2030-01-02", "09:00", "TODO");
        String id = rule(Map.of("taskId", "t1"));
        Map<String, Object> run = workspace.triggerRule(OWNER, id);
        assertEquals("manual", run.get("source"));
        assertEquals("SUCCESS", run.get("status"));
        assertEquals(1, notifications());
        assertEquals("Task t1", repository.list(StorageTables.NOTIFICATIONS, OWNER).get(0).get("Title"));
    }

    @Test
    void oneTaskWithAMalformedDateDoesNotStopTheRuleForTheOthers() {
        task("bad", "2030-13-45", "09:00", "TODO");
        task("badTime", "2030-01-02", "25:99", "TODO");
        task("good", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(0)));
        engine.sweepOwner(OWNER, utc("2030-01-02T09:01:00"));
        assertEquals(1, notifications(), "the good task still fires");
    }

    @Test
    void trimmingOldRunsNeverDeletesTheKeyThatStopsARecentMomentFiringTwice() {
        task("t1", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(0)));
        long now = System.currentTimeMillis();
        // A busy owner: more than the cap of runs, all recent and all guarding a firing.
        for (int i = 0; i < 520; i++) {
            Map<String, Object> run = new LinkedHashMap<>();
            run.put("RunId", "r" + i);
            run.put("RuleId", "x");
            run.put("TriggeredAt", now - i);
            run.put("FireKey", "key-" + i);
            repository.insert(StorageTables.RUNS, OWNER, run);
        }
        engine.sweepOwner(OWNER, utc("2030-01-02T09:01:00"));
        assertTrue(runs() >= 520, "recent runs that guard a firing are kept even above the cap");
    }

    @Test
    void oneOwnersRulesNeverTouchAnothersTasks() {
        task("t1", "2030-01-02", "09:00", "TODO");
        rule(Map.of("offsetMinutes", List.of(0)));
        Map<String, Object> other = new LinkedHashMap<>();
        other.put("TaskId", "x1");
        other.put("Title", "Someone else");
        other.put("Status", "TODO");
        other.put("DueDate", "2030-01-02");
        other.put("DueTime", "09:00");
        repository.insert(StorageTables.TASKS, "owner-2", other);
        engine.sweep(utc("2030-01-02T09:01:00"));
        assertEquals(1, notifications());
        assertEquals(0, repository.list(StorageTables.NOTIFICATIONS, "owner-2").size());
    }

    private static final class MemoryStore implements RowStore {
        private final Map<String, List<Map<String, Object>>> tables = new LinkedHashMap<>();
        private long next = 1L;

        @Override
        public List<Map<String, Object>> findByOwner(String table, String ownerId) {
            return table(table).stream()
                .filter(row -> ownerId.equals(String.valueOf(row.getOrDefault("OwnerId", ""))))
                .<Map<String, Object>>map(LinkedHashMap::new)
                .toList();
        }

        @Override
        public Map<String, Object> insert(String table, Map<String, Object> row) {
            Map<String, Object> stored = new LinkedHashMap<>(row);
            stored.put("ROWID", String.valueOf(next++));
            table(table).add(stored);
            return new LinkedHashMap<>(stored);
        }

        @Override
        public Map<String, Object> update(String table, String rowId, Map<String, Object> row) {
            List<Map<String, Object>> rows = table(table);
            for (int i = 0; i < rows.size(); i++) {
                if (rowId.equals(String.valueOf(rows.get(i).get("ROWID")))) {
                    Map<String, Object> stored = new LinkedHashMap<>(row);
                    stored.put("ROWID", rowId);
                    rows.set(i, stored);
                    return new LinkedHashMap<>(stored);
                }
            }
            throw new IllegalStateException("missing row " + rowId);
        }

        @Override
        public void delete(String table, String rowId) {
            table(table).removeIf(row -> rowId.equals(String.valueOf(row.get("ROWID"))));
        }

        @Override
        public List<String> owners(String table) {
            return table(table).stream().map(row -> String.valueOf(row.get("OwnerId"))).distinct().toList();
        }

        @Override
        public String mode() {
            return "postgres";
        }

        private List<Map<String, Object>> table(String table) {
            return tables.computeIfAbsent(table, ignored -> new ArrayList<>());
        }
    }
}
