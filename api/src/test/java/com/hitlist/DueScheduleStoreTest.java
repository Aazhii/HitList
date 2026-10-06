package com.hitlist;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.domain.EntityRepository;
import com.hitlist.storage.DueScheduleStore;
import com.hitlist.storage.JdbcRowStore;
import com.hitlist.storage.StorageTables;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import static org.assertj.core.api.Assertions.assertThat;

class DueScheduleStoreTest {
    @TempDir Path temp;

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> tasks(Map<String, Object> batch) {
        return (List<Map<String, Object>>) batch.get("tasks");
    }

    @Test
    void repositoryWritesMaintainSchedulesAndIsolatedDurableReceipts() {
        var source = new DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("schedule.db"));
        var rows = new JdbcRowStore(source, new ObjectMapper(), "sqlite");
        var repository = new EntityRepository(rows);
        var schedule = new DueScheduleStore(source, rows);
        repository.setSchedules(schedule);
        Map<String, Object> task = Map.of("TaskId", "task", "Title", "Due", "Status", "TODO", "DueDate", "2030-01-01", "DueTime", "10:00");
        repository.insert(StorageTables.TASKS, "workspace", task);
        var zone = ZoneId.of("Asia/Kolkata");
        long due = DueScheduleStore.dueAt("2030-01-01", "10:00", zone);
        assertThat(tasks(schedule.reserve("account", "workspace", zone, due - 1))).isEmpty();
        var first = schedule.reserve("account", "workspace", zone, due);
        assertThat(tasks(first)).hasSize(1);
        assertThat(tasks(schedule.reserve("account", "workspace", zone, due))).isEmpty();
        assertThat(tasks(schedule.reserve("other", "workspace", zone, due))).hasSize(1);
        schedule.finish("account", "workspace", first.get("batchId").toString(), tasks(first), true, due);
        var renamed = new java.util.LinkedHashMap<>(task);
        renamed.put("Title", "Renamed");
        repository.replace(StorageTables.TASKS, "workspace", "task", renamed);
        assertThat(tasks(schedule.reserve("account", "workspace", zone, due + 180_000))).isEmpty();
        var reopened = new DueScheduleStore(source, rows);
        assertThat(tasks(reopened.reserve("account", "workspace", zone, due + 180_000))).isEmpty();
        repository.replace(StorageTables.TASKS, "workspace", "task", Map.of("TaskId", "task", "Title", "Cleared", "Status", "TODO", "DueDate", "", "DueTime", ""));
        assertThat(tasks(schedule.reserve("other", "workspace", zone, due + 180_000))).isEmpty();
        repository.replace(StorageTables.TASKS, "workspace", "task", task);
        var fresh = schedule.reserve("account", "workspace", zone, due + 180_000);
        assertThat(tasks(fresh)).hasSize(1);
        repository.delete(StorageTables.TASKS, "workspace", "task");
        assertThat(schedule.validate("account", "workspace", fresh.get("batchId").toString(), due + 180_000)).isEmpty();
    }

    @Test
    void boundedBatchesCompletionReschedulingTimezoneAndRollback() {
        var source = new DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("bounded.db"));
        var rows = new JdbcRowStore(source, new ObjectMapper(), "sqlite");
        var repository = new EntityRepository(rows);
        var schedule = new DueScheduleStore(source, rows);
        repository.setSchedules(schedule);
        for (int index = 0; index < 21; index++) {
            repository.insert(StorageTables.TASKS, "owner", Map.of("TaskId", "task-" + index, "Title", "Task", "DueDate", "2030-01-01", "Status", "TODO"));
        }
        var zone = ZoneId.of("UTC");
        long now = DueScheduleStore.dueAt("2030-01-02", "", zone);
        var batch = schedule.reserve("account", "owner", zone, now);
        assertThat(tasks(batch)).hasSize(20);
        schedule.finish("account", "owner", batch.get("batchId").toString(), tasks(batch), true, now);
        var last = schedule.reserve("account", "owner", ZoneId.of("America/New_York"), now);
        assertThat(tasks(last)).hasSize(1);
        schedule.finish("account", "owner", last.get("batchId").toString(), tasks(last), true, now);
        assertThat(tasks(schedule.reserve("account", "owner", zone, now))).isEmpty();
        repository.replace(StorageTables.TASKS, "owner", "task-0", Map.of("TaskId", "task-0", "Title", "Done", "DueDate", "2030-01-01", "Status", "DONE"));
        assertThat(tasks(schedule.reserve("other", "owner", zone, now))).hasSize(20);
        repository.replace(StorageTables.TASKS, "owner", "task-0", Map.of("TaskId", "task-0", "Title", "Reopened", "DueDate", "2030-01-01", "Status", "TODO"));
        assertThat(tasks(schedule.reserve("account", "owner", zone, now))).hasSize(1);
        repository.replace(StorageTables.TASKS, "owner", "task-0", Map.of("TaskId", "task-0", "Title", "Rescheduled", "DueDate", "2030-01-02", "Status", "TODO"));
        assertThat(tasks(schedule.reserve("account", "owner", zone, now))).hasSize(1);
        var transaction = new org.springframework.transaction.support.TransactionTemplate(new org.springframework.jdbc.datasource.DataSourceTransactionManager(source));
        transaction.executeWithoutResult(state -> {
            repository.delete(StorageTables.TASKS, "owner", "task-0");
            state.setRollbackOnly();
        });
        assertThat(repository.find(StorageTables.TASKS, "owner", "task-0")).isPresent();
        assertThat(tasks(schedule.reserve("new-account", "owner", zone, now))).hasSize(20);
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(source);
        assertThat(jdbc.queryForList("EXPLAIN QUERY PLAN SELECT * FROM hitlist_due_schedule WHERE owner_id='owner' AND due_at<=0 ORDER BY due_at LIMIT 20").toString())
            .contains("hitlist_due_time_idx");
    }

    @Test
    void endpointsRequireDesktopIdentityAndWorkspaceMembership() {
        var properties = new com.hitlist.config.HitListProperties();
        properties.setAuthMode("desktop");
        properties.setDesktopToken("x".repeat(32));
        var owners = new com.hitlist.auth.OwnerResolver(properties);
        var schedules = org.mockito.Mockito.mock(DueScheduleStore.class);
        var sync = org.mockito.Mockito.mock(com.hitlist.domain.SyncService.class);
        var controller = new com.hitlist.web.OverdueController(schedules, owners, sync);
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.reserve(Map.of("timezone", "UTC"), request))
            .isInstanceOf(com.hitlist.web.ApiException.class);
        String account = owners.catalystOwner("75733000000033001");
        String workspace = "w".repeat(43);
        request.addHeader("X-Hitlist-Desktop-Token", "x".repeat(32));
        request.addHeader("X-Hitlist-Desktop-Owner", account);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.reserve(Map.of("workspaceId", workspace, "timezone", "UTC"), request))
            .isInstanceOf(com.hitlist.web.ApiException.class);
        org.mockito.Mockito.verifyNoInteractions(schedules);
        org.mockito.Mockito.when(sync.canUse(account, workspace, false)).thenReturn(true);
        controller.reserve(Map.of("workspaceId", workspace, "timezone", "UTC"), request);
        org.mockito.Mockito.verify(schedules).reserve(org.mockito.ArgumentMatchers.eq(account), org.mockito.ArgumentMatchers.eq(workspace),
            org.mockito.ArgumentMatchers.eq(ZoneId.of("UTC")), org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void dateOnlyUsesLocalEndOfDayAndExpiredLeasesRetry() {
        var source = new DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("retry.db"));
        var rows = new JdbcRowStore(source, new ObjectMapper(), "sqlite");
        rows.insert(StorageTables.TASKS, Map.of("OwnerId", "owner", "TaskId", "old", "Title", "Imported", "DueDate", "2030-01-01"));
        var schedule = new DueScheduleStore(source, rows);
        var zone = ZoneId.of("UTC");
        long due = DueScheduleStore.dueAt("2030-01-01", "", zone);
        assertThat(java.time.Instant.ofEpochMilli(due).atZone(zone).toLocalTime()).isEqualTo(java.time.LocalTime.of(23, 59, 59));
        var batch = schedule.reserve("account", "owner", zone, due);
        assertThat(tasks(batch)).hasSize(1);
        assertThat(tasks(schedule.reserve("account", "owner", zone, due + 120_000))).hasSize(1);
        schedule.finish("account", "owner", batch.get("batchId").toString(), tasks(batch), true, due);
        assertThat(tasks(schedule.reserve("account", "owner", zone, due + 240_000))).hasSize(1);
    }
}