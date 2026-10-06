package com.hitlist;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.domain.AutomationRunner;
import com.hitlist.domain.EntityRepository;
import com.hitlist.domain.TaskService;
import com.hitlist.domain.WorkspaceService;
import com.hitlist.storage.AutomationQueue;
import com.hitlist.storage.JdbcRowStore;
import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** The stored-queue engine on real SQLite: when moments are stored, when they run, and that they run once. */
class AutomationRunnerTest {
    private static final String OWNER = "owner-1";
    private static final long MIN = 60_000L;
    @TempDir Path folder;

    private DataSource source;
    private RowStore rows;
    private EntityRepository repository;
    private AutomationQueue queue;
    private AutomationRunner runner;
    private WorkspaceService workspace;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        build(null);
    }

    private void build(AtomicBoolean failNotifications) {
        source = new DriverManagerDataSource("jdbc:sqlite:" + folder.resolve(UUID.randomUUID() + ".db"));
        wire(failNotifications);
    }

    /** (Re)builds the services over the same database, as a restart of the app does. */
    private void wire(AtomicBoolean failNotifications) {
        RowStore real = new JdbcRowStore(source, mapper, "sqlite");
        rows = failNotifications == null ? real : new FailingNotifications(real, failNotifications);
        repository = new EntityRepository(rows);
        queue = new AutomationQueue(source, real);
        runner = new AutomationRunner(repository, queue, mapper, new TaskService(repository), new DataSourceTransactionManager(source));
        workspace = new WorkspaceService(repository, mapper);
        workspace.setAutomationEngine(queue, runner);
    }

    private static long utc(String iso) {
        return LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli();
    }

    private void task(String id, String date, String time, String status, String category) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("TaskId", id);
        row.put("Title", "Task " + id);
        row.put("Status", status);
        row.put("DueDate", date);
        row.put("DueTime", time);
        row.put("Category", category);
        row.put("CreatedAt", 1L);
        repository.insert(StorageTables.TASKS, OWNER, row);
    }

    private String rule(Map<String, Object> spec) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Nudge");
        body.put("status", "active");
        body.put("timezone", "UTC");
        body.put("spec", spec);
        return String.valueOf(workspace.createRule(OWNER, body).get("id"));
    }

    private static Map<String, Object> spec(Map<String, Object> trigger, List<Map<String, Object>> actions, List<Map<String, Object>> conditions) {
        Map<String, Object> spec = new LinkedHashMap<>();
        spec.put("source", "tasks");
        spec.put("triggers", List.of(trigger));
        spec.put("conditions", conditions);
        spec.put("actions", actions);
        return spec;
    }

    private static Map<String, Object> dueOffsets(Long... offsets) {
        return Map.of("kind", "date-reached", "offsets", List.of(offsets));
    }

    private static final List<Map<String, Object>> IN_APP = List.of(Map.of("kind", "notify-in-app"));

    private int notifications() {
        return repository.list(StorageTables.NOTIFICATIONS, OWNER).size();
    }

    private int runs() {
        return repository.list(StorageTables.RUNS, OWNER).size();
    }

    private Map<String, Object> ruleRow(String id) {
        return repository.require(StorageTables.RULES, OWNER, id);
    }

    @Test
    void aMomentIsStoredWithItsExecuteAtAndRunsOnlyOnceNowReachesIt() {
        task("t1", "2030-01-02", "09:00", "TODO", "");
        String id = rule(spec(dueOffsets(-30L), IN_APP, List.of()));

        runner.tick(utc("2030-01-02T08:20:00"));
        assertThat(queue.rows(OWNER, id)).as("nothing is stored until it is within two minutes").isEmpty();
        assertThat(Long.parseLong(String.valueOf(ruleRow(id).get("NextTriggerAt")))).isEqualTo(utc("2030-01-02T08:30:00"));

        runner.tick(utc("2030-01-02T08:29:00"));
        assertThat(queue.rows(OWNER, id)).hasSize(1);
        assertThat(queue.rows(OWNER, id).get(0).get("executeAt")).isEqualTo(utc("2030-01-02T08:30:00"));
        assertThat(queue.rows(OWNER, id).get(0).get("state")).isEqualTo("pending");
        assertThat(notifications()).as("stored, but now < executeAt").isZero();

        runner.tick(utc("2030-01-02T08:30:30"));
        assertThat(notifications()).isEqualTo(1);
        assertThat(runs()).isEqualTo(1);
        assertThat(queue.rows(OWNER, id).get(0).get("state")).isEqualTo("done");
        var note = repository.list(StorageTables.NOTIFICATIONS, OWNER).get(0);
        assertThat(note.get("Title")).isEqualTo("Task t1");
        assertThat(note.get("Body")).isEqualTo("Due in 30 minutes · Nudge");

        runner.tick(utc("2030-01-02T08:31:30"));
        wire(null);
        runner.tick(utc("2030-01-02T08:32:30"));
        assertThat(notifications()).as("not again, not even after a restart").isEqualTo(1);
    }

    @Test
    void severalOffsetsEachRunOnceAndADoneOrMalformedTaskIsLeftOut() {
        task("t1", "2030-01-02", "09:00", "TODO", "");
        task("done", "2030-01-02", "09:00", "DONE", "");
        task("bad", "2030-13-45", "09:00", "TODO", "");
        task("badTime", "2030-01-02", "25:99", "TODO", "");
        rule(spec(dueOffsets(-60L, 0L), IN_APP, List.of()));
        for (String at : List.of("08:00:30", "08:30:00", "09:00:30", "09:30:00")) runner.tick(utc("2030-01-02T" + at));
        assertThat(notifications()).as("two offsets, one good task").isEqualTo(2);
    }

    @Test
    void conditionsAreCheckedOnTheItemAsItIsWhenTheMomentRuns() {
        task("work", "2030-01-02", "09:00", "TODO", "work");
        task("home", "2030-01-02", "09:00", "TODO", "personal");
        rule(spec(dueOffsets(0L), IN_APP, List.of(Map.of("field", "category", "op", "is", "value", "work"))));
        runner.tick(utc("2030-01-02T08:59:00"));
        // The task changes between planning and running: the condition is read at run time.
        Map<String, Object> changed = new LinkedHashMap<>(repository.require(StorageTables.TASKS, OWNER, "work"));
        changed.put("Category", "personal");
        repository.replace(StorageTables.TASKS, OWNER, "work", changed);
        runner.tick(utc("2030-01-02T09:00:30"));
        assertThat(notifications()).isZero();
        assertThat(runs()).isZero();
    }

    @Test
    void aDailyScheduleFiresOncePerDayAtItsTime() {
        rule(spec(Map.of("kind", "every", "frequency", "daily", "time", "09:00"), IN_APP, List.of()));
        runner.tick(utc("2030-01-02T08:30:00"));
        assertThat(notifications()).isZero();
        runner.tick(utc("2030-01-02T08:59:30"));
        runner.tick(utc("2030-01-02T09:00:30"));
        runner.tick(utc("2030-01-02T09:05:00"));
        assertThat(notifications()).isEqualTo(1);
        runner.tick(utc("2030-01-03T09:00:30"));
        assertThat(notifications()).isEqualTo(2);
    }

    @Test
    void aWeeklyMondayReminderFiresOncePerWeekWithItsOwnWords() {
        // 2030-01-07 is a Monday.
        rule(spec(Map.of("kind", "every", "frequency", "weekly", "time", "09:30", "dayOfWeek", 1),
            List.of(Map.of("kind", "notify-in-app", "template", "Time for the weekly update.")), List.of()));
        runner.tick(utc("2030-01-07T09:00:00"));
        assertThat(notifications()).isZero();
        runner.tick(utc("2030-01-07T09:30:30"));
        runner.tick(utc("2030-01-07T09:45:00"));
        assertThat(notifications()).isEqualTo(1);
        assertThat(String.valueOf(repository.list(StorageTables.NOTIFICATIONS, OWNER).get(0).get("Body"))).isEqualTo("Time for the weekly update.");
        runner.tick(utc("2030-01-08T09:30:30"));
        assertThat(notifications()).as("not on Tuesday").isEqualTo(1);
        runner.tick(utc("2030-01-14T09:30:30"));
        assertThat(notifications()).isEqualTo(2);
    }

    @Test
    void anAddedItemAndAStatusBecomingDoneAreFoundByComparisonAndTheFirstLookOnlyRecords() {
        task("old", "", "", "TODO", "");
        rule(spec(Map.of("kind", "status-becomes", "status", "DONE"), IN_APP, List.of()));
        String added = rule(spec(Map.of("kind", "item-added"), IN_APP, List.of()));
        runner.tick(utc("2030-01-02T08:00:00"));
        assertThat(notifications()).as("the first look only records").isZero();

        task("fresh", "", "", "TODO", "");
        Map<String, Object> done = new LinkedHashMap<>(repository.require(StorageTables.TASKS, OWNER, "old"));
        done.put("Status", "DONE");
        repository.replace(StorageTables.TASKS, OWNER, "old", done);
        runner.tick(utc("2030-01-02T08:01:00"));
        assertThat(notifications()).as("one for the item added, one for the status").isEqualTo(2);
        runner.tick(utc("2030-01-02T08:02:00"));
        assertThat(notifications()).isEqualTo(2);
        assertThat(added).isNotBlank();
    }

    @Test
    void theCliqActionQueuesOneCombinedMessageForTheDesktopToDeliver() {
        for (int i = 1; i <= 3; i++) task("t" + i, "2030-01-02", "09:00", "TODO", "");
        String id = rule(spec(dueOffsets(0L), List.of(Map.of("kind", "notify-cliq")), List.of()));
        runner.tick(utc("2030-01-02T08:59:00"));
        runner.tick(utc("2030-01-02T09:00:30"));
        var outbox = queue.outboxFor(OWNER, id);
        assertThat(outbox).hasSize(1);
        String text = String.valueOf(outbox.get(0).get("payload"));
        assertThat(text).contains("Nudge", "3 items", "Task t1", "Task t2", "Task t3");
        assertThat(runs()).isEqualTo(1);
        assertThat(String.valueOf(repository.list(StorageTables.RUNS, OWNER).get(0).get("Channels"))).contains("cliq");
        assertThat(notifications()).as("no in-app notification unless asked").isZero();
    }

    @Test
    void aTaskNoteTravelsInTheDefaultMessageAndTheNoteToken() {
        task("t1", "2030-01-02", "09:00", "TODO", "");
        Map<String, Object> noted = new LinkedHashMap<>(repository.require(StorageTables.TASKS, OWNER, "t1"));
        noted.put("Note", "asked to @mandy\n  this isn't added");
        repository.replace(StorageTables.TASKS, OWNER, "t1", noted);
        String plain = rule(spec(dueOffsets(0L), List.of(Map.of("kind", "notify-cliq")), List.of()));
        String custom = rule(spec(dueOffsets(0L), List.of(Map.of("kind", "notify-cliq", "template", "{{title}} | {{note}}")), List.of()));
        runner.tick(utc("2030-01-02T08:59:00"));
        runner.tick(utc("2030-01-02T09:00:30"));
        assertThat(String.valueOf(queue.outboxFor(OWNER, plain).get(0).get("payload"))).contains("Task t1").contains("↳ asked to @mandy this isn't added");
        String own = String.valueOf(queue.outboxFor(OWNER, custom).get(0).get("payload"));
        assertThat(own).contains("Task t1 | asked to @mandy this isn't added").doesNotContain("↳");
    }

    @Test
    void aSingleItemUsesTheTemplateAndQuietHoursHoldTheMessageUntilTheyEnd() {
        task("t1", "2030-01-02", "23:30", "TODO", "");
        Map<String, Object> cliq = new LinkedHashMap<>();
        cliq.put("kind", "notify-cliq");
        cliq.put("template", "Heads up: {{title}} is due {{due}}");
        cliq.put("quietFrom", "22:00");
        cliq.put("quietTo", "07:00");
        String id = rule(spec(dueOffsets(0L), List.of(cliq), List.of()));
        runner.tick(utc("2030-01-02T23:29:00"));
        runner.tick(utc("2030-01-02T23:30:30"));
        var outbox = queue.outboxFor(OWNER, id);
        assertThat(outbox).hasSize(1);
        assertThat(String.valueOf(outbox.get(0).get("payload"))).contains("Heads up: Task t1 is due 2030-01-02 23:30");
        assertThat(outbox.get(0).get("notBefore")).isEqualTo(utc("2030-01-03T07:00:00"));
        assertThat(queue.reserveOutbox(OWNER, "cliq", utc("2030-01-03T06:00:00"), 10).get("items")).asList().isEmpty();
        assertThat(queue.reserveOutbox(OWNER, "cliq", utc("2030-01-03T07:00:01"), 10).get("items")).asList().hasSize(1);
    }

    @Test
    void theDailyCapStopsMoreMessagesAndSaysSo() {
        for (int i = 1; i <= 3; i++) task("t" + i, "2030-01-02", "09:0" + i, "TODO", "");
        Map<String, Object> cliq = new LinkedHashMap<>();
        cliq.put("kind", "notify-cliq");
        cliq.put("combine", false);
        cliq.put("dailyCap", 2);
        String id = rule(spec(dueOffsets(0L), List.of(cliq), List.of()));
        for (String at : List.of("09:00:30", "09:01:30", "09:02:30", "09:03:30")) runner.tick(utc("2030-01-02T" + at));
        assertThat(queue.outboxFor(OWNER, id)).hasSize(2);
        assertThat(repository.list(StorageTables.RUNS, OWNER).stream().map(r -> String.valueOf(r.get("Detail"))).toList())
            .anySatisfy(detail -> assertThat(detail).contains("daily limit of 2 reached"));
    }

    @Test
    void theOutboxIsReservedAcknowledgedAndRetriedLikeTheOverdueAlerts() {
        long now = utc("2030-01-02T09:00:00");
        queue.addOutbox(OWNER, "r", "run", "cliq", "{\"text\":\"hi\"}", 0, now);
        var first = queue.reserveOutbox(OWNER, "cliq", now, 10);
        assertThat((List<?>) first.get("items")).hasSize(1);
        assertThat((List<?>) queue.reserveOutbox(OWNER, "cliq", now + MIN, 10).get("items")).as("reserved, not handed out twice").isEmpty();
        String id = String.valueOf(((Map<?, ?>) ((List<?>) first.get("items")).get(0)).get("id"));
        queue.finishOutbox(OWNER, String.valueOf(first.get("batchId")), List.of(id), false, now + MIN);
        assertThat((List<?>) queue.reserveOutbox(OWNER, "cliq", now + MIN + 1_000, 10).get("items")).as("a failed send waits a minute").isEmpty();
        var again = queue.reserveOutbox(OWNER, "cliq", now + 2 * MIN + 1, 10);
        assertThat((List<?>) again.get("items")).hasSize(1);
        queue.finishOutbox(OWNER, String.valueOf(again.get("batchId")), List.of(id), true, now + 3 * MIN);
        assertThat((List<?>) queue.reserveOutbox(OWNER, "cliq", now + 10 * MIN, 10).get("items")).isEmpty();
        // A reservation that is never answered (the app closed) comes back after its lease.
        queue.addOutbox(OWNER, "r", "run", "cliq", "{\"text\":\"lost\"}", 0, now);
        assertThat((List<?>) queue.reserveOutbox(OWNER, "cliq", now + 20 * MIN, 10).get("items")).hasSize(1);
        assertThat((List<?>) queue.reserveOutbox(OWNER, "cliq", now + 20 * MIN + AutomationQueue.LEASE_MS + 1, 10).get("items")).hasSize(1);
    }

    @Test
    void aRunThatCrashesHalfWayLeavesNothingBehindAndIsTriedAgainOnce() {
        AtomicBoolean fail = new AtomicBoolean(true);
        build(fail);
        task("t1", "2030-01-02", "09:00", "TODO", "");
        String id = rule(spec(dueOffsets(0L), IN_APP, List.of()));
        runner.tick(utc("2030-01-02T08:59:00"));
        runner.tick(utc("2030-01-02T09:00:30"));
        assertThat(notifications()).isZero();
        assertThat(runs()).as("the run record rolled back with the notification").isZero();
        assertThat(queue.rows(OWNER, id).get(0).get("state")).isEqualTo("claimed");

        runner.tick(utc("2030-01-02T09:00:30") + AutomationQueue.LEASE_MS + 1_000);
        assertThat(notifications()).isEqualTo(1);
        assertThat(runs()).isEqualTo(1);
        assertThat(queue.rows(OWNER, id).get(0).get("state")).isEqualTo("done");
    }

    @Test
    void aRuleFromBeforeTheNewShapeStillRunsAndPausedRulesStaySilent() {
        task("t1", "2030-01-02", "09:00", "TODO", "");
        Map<String, Object> legacy = new LinkedHashMap<>();
        legacy.put("name", "Old rule");
        legacy.put("triggerType", "due-date");
        legacy.put("status", "active");
        legacy.put("offsetMinutes", List.of(-30));
        legacy.put("notifyInApp", true);
        legacy.put("timezone", "UTC");
        workspace.createRule(OWNER, legacy);
        Map<String, Object> paused = new LinkedHashMap<>(legacy);
        paused.put("name", "Paused rule");
        paused.put("status", "paused");
        workspace.createRule(OWNER, paused);
        runner.tick(utc("2030-01-02T08:29:00"));
        runner.tick(utc("2030-01-02T08:31:00"));
        assertThat(notifications()).isEqualTo(1);
        assertThat(String.valueOf(repository.list(StorageTables.NOTIFICATIONS, OWNER).get(0).get("Body"))).startsWith("Due in 30 minutes");
        var api = workspace.automationRules(OWNER).stream().filter(r -> "Old rule".equals(r.get("name"))).findFirst().orElseThrow();
        assertThat(String.valueOf(api.get("spec"))).contains("date-reached");
    }

    @Test
    void remindersThatCameAndWentWhileTheAppWasClosedAreRecordedOnceNotRunLate() {
        task("t1", "2030-01-02", "10:00", "TODO", "");
        Map<String, Object> shortWindow = spec(dueOffsets(0L), IN_APP, List.of());
        shortWindow.put("options", Map.of("catchUpMinutes", 120));
        rule(shortWindow);
        runner.tick(utc("2030-01-02T14:00:00"));
        assertThat(notifications()).isZero();
        assertThat(runs()).isEqualTo(1);
        var run = repository.list(StorageTables.RUNS, OWNER).get(0);
        assertThat(run.get("RunStatus")).isEqualTo("SKIPPED");
        assertThat(String.valueOf(run.get("Detail"))).contains("1 reminder was missed");
        runner.tick(utc("2030-01-02T14:01:00"));
        assertThat(runs()).as("recorded once").isEqualTo(1);
    }

    @Test
    void withTheDefaultWindowAMomentFromEarlierTodayStillRunsOnceWhenTheAppOpens() {
        task("t1", "2030-01-02", "10:00", "TODO", "");
        rule(spec(dueOffsets(0L), IN_APP, List.of()));
        runner.tick(utc("2030-01-02T14:00:00"));
        runner.tick(utc("2030-01-02T14:01:00"));
        assertThat(notifications()).as("caught up once, within the 24 hour window").isEqualTo(1);
    }

    @Test
    void runNowRunsTheActionsOnceByHandAndABadSpecIsRefused() {
        String id = rule(spec(Map.of("kind", "manual"), List.of(Map.of("kind", "notify-cliq")), List.of()));
        var run = workspace.triggerRule(OWNER, id);
        assertThat(run.get("source")).isEqualTo("manual");
        assertThat(queue.outboxFor(OWNER, id)).hasSize(1);
        org.junit.jupiter.api.Assertions.assertThrows(com.hitlist.web.ApiException.class, () -> rule(spec(Map.of("kind", "nope"), IN_APP, List.of())));
        org.junit.jupiter.api.Assertions.assertThrows(com.hitlist.web.ApiException.class,
            () -> rule(spec(dueOffsets(0L), List.of(Map.of("kind", "send-everything")), List.of())));
        org.junit.jupiter.api.Assertions.assertThrows(com.hitlist.web.ApiException.class,
            () -> rule(spec(Map.of("kind", "every", "frequency", "daily", "time", "9am"), IN_APP, List.of())));
    }

    /** Fails the first write of a notification, as a crash between two writes would. */
    private record FailingNotifications(RowStore delegate, AtomicBoolean fail) implements RowStore {
        public List<Map<String, Object>> findByOwner(String table, String owner) { return delegate.findByOwner(table, owner); }
        public Map<String, Object> insert(String table, Map<String, Object> row) {
            if (StorageTables.NOTIFICATIONS.equals(table) && fail.compareAndSet(true, false)) throw new IllegalStateException("crash");
            return delegate.insert(table, row);
        }
        public Map<String, Object> update(String table, String rowId, Map<String, Object> row) { return delegate.update(table, rowId, row); }
        public void delete(String table, String rowId) { delegate.delete(table, rowId); }
        public List<String> owners(String table) { return delegate.owners(table); }
        public String mode() { return delegate.mode(); }
    }
}
