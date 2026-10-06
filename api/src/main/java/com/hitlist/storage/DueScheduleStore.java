package com.hitlist.storage;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class DueScheduleStore {
    private final JdbcTemplate jdbc;
    private final boolean local;

    public DueScheduleStore(DataSource source, RowStore rows) {
        jdbc = new JdbcTemplate(java.util.Objects.requireNonNull(source));
        local = "sqlite".equals(rows.mode());
        if (!local) return;
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS hitlist_due_schedule (
              owner_id TEXT NOT NULL, task_id TEXT NOT NULL, occurrence TEXT NOT NULL,
              due_date TEXT NOT NULL, due_time TEXT NOT NULL, due_at BIGINT NOT NULL,
              title TEXT NOT NULL, PRIMARY KEY (owner_id, task_id))
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS hitlist_due_time_idx ON hitlist_due_schedule(owner_id, due_at, task_id)");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS hitlist_due_delivery (
              account_id TEXT NOT NULL, owner_id TEXT NOT NULL, task_id TEXT NOT NULL,
              occurrence TEXT NOT NULL, batch_id TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
              retry_at BIGINT NOT NULL DEFAULT 0,
              PRIMARY KEY(account_id, owner_id, task_id, occurrence))
            """);
        jdbc.execute("CREATE TABLE IF NOT EXISTS hitlist_due_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
        jdbc.update("INSERT INTO hitlist_due_meta(name, value) VALUES ('zone', ?) ON CONFLICT(name) DO NOTHING", ZoneId.systemDefault().getId());
        for (String owner : rows.owners(StorageTables.TASKS)) {
            for (Map<String, Object> task : rows.findByOwner(StorageTables.TASKS, owner)) upsert(owner, task);
        }
        jdbc.update("DELETE FROM hitlist_due_schedule WHERE NOT EXISTS (SELECT 1 FROM hitlist_storage_rows r WHERE r.table_name=? AND r.owner_id=hitlist_due_schedule.owner_id AND r.entity_key=hitlist_due_schedule.task_id)", StorageTables.TASKS);
        jdbc.update("INSERT INTO hitlist_due_meta(name, value) VALUES ('backfill', '1') ON CONFLICT(name) DO UPDATE SET value='1'");
    }

    @Transactional
    public synchronized void upsert(String owner, Map<String, Object> task) {
        if (!local) return;
        String id = text(task, "TaskId"), date = text(task, "DueDate"), time = text(task, "DueTime");
        if (date.isBlank() || "DONE".equals(text(task, "Status"))) {
            remove(owner, id);
            return;
        }
        ZoneId zone = ZoneId.of(jdbc.queryForObject("SELECT value FROM hitlist_due_meta WHERE name='zone'", String.class));
        long due;
        try { due = dueAt(date, time, zone); }
        catch (java.time.DateTimeException invalid) { remove(owner, id); return; }
        jdbc.update("""
            INSERT INTO hitlist_due_schedule(owner_id,task_id,occurrence,due_date,due_time,due_at,title)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,task_id) DO UPDATE SET
              occurrence=CASE WHEN hitlist_due_schedule.due_date=excluded.due_date AND hitlist_due_schedule.due_time=excluded.due_time
                THEN hitlist_due_schedule.occurrence ELSE excluded.occurrence END,
              due_date=excluded.due_date,due_time=excluded.due_time,due_at=excluded.due_at,title=excluded.title
            """, owner, id, UUID.randomUUID().toString(), date, time, due, text(task, "Title"));
        jdbc.update("DELETE FROM hitlist_due_delivery WHERE owner_id=? AND task_id=? AND occurrence NOT IN (SELECT occurrence FROM hitlist_due_schedule WHERE owner_id=? AND task_id=?)", owner, id, owner, id);
    }

    @Transactional
    public synchronized void remove(String owner, String id) {
        if (!local) return;
        jdbc.update("DELETE FROM hitlist_due_schedule WHERE owner_id=? AND task_id=?", owner, id);
        jdbc.update("DELETE FROM hitlist_due_delivery WHERE owner_id=? AND task_id=?", owner, id);
    }

    public static long dueAt(String date, String time, ZoneId zone) {
        return LocalDate.parse(date).atTime(time.isBlank() ? LocalTime.of(23, 59, 59) : LocalTime.parse(time)).atZone(zone).toInstant().toEpochMilli();
    }

    private void rezone(ZoneId zone) {
        String previous = jdbc.queryForObject("SELECT value FROM hitlist_due_meta WHERE name='zone'", String.class);
        if (zone.getId().equals(previous)) return;
        for (Map<String, Object> row : jdbc.queryForList("SELECT owner_id,task_id,due_date,due_time FROM hitlist_due_schedule")) {
            jdbc.update("UPDATE hitlist_due_schedule SET due_at=? WHERE owner_id=? AND task_id=?",
                dueAt(text(row, "due_date"), text(row, "due_time"), zone), row.get("owner_id"), row.get("task_id"));
        }
        jdbc.update("UPDATE hitlist_due_meta SET value=? WHERE name='zone'", zone.getId());
    }

    @Transactional
    public synchronized Map<String, Object> reserve(String account, String owner, ZoneId zone, long now) {
        if (!local) throw new IllegalStateException("Local scheduling requires SQLite");
        rezone(zone);
        String batch = UUID.randomUUID().toString();
        List<Map<String, Object>> tasks = jdbc.queryForList("""
            SELECT s.task_id AS id,s.occurrence,s.title,s.due_date AS dueDate,s.due_time AS dueTime,s.due_at AS dueAt,
              (SELECT json_extract(r.data,'$.Note') FROM hitlist_storage_rows r WHERE r.table_name='KaizenTasks' AND r.owner_id=s.owner_id AND r.entity_key=s.task_id) AS note
            FROM hitlist_due_schedule s LEFT JOIN hitlist_due_delivery d
              ON d.account_id=? AND d.owner_id=s.owner_id AND d.task_id=s.task_id AND d.occurrence=s.occurrence
            WHERE s.owner_id=? AND s.due_at<=? AND (d.sent IS NULL OR (d.sent=0 AND d.retry_at<=?))
            ORDER BY s.due_at,s.task_id LIMIT 20
            """, account, owner, now, now);
        for (Map<String, Object> task : tasks) {
            jdbc.update("""
                INSERT INTO hitlist_due_delivery(account_id,owner_id,task_id,occurrence,batch_id,retry_at)
                VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,owner_id,task_id,occurrence)
                DO UPDATE SET batch_id=excluded.batch_id,retry_at=excluded.retry_at
                """, account, owner, task.get("id"), task.get("occurrence"), batch, now + 120_000);
        }
        return Map.of("batchId", batch, "tasks", tasks);
    }

    public List<Map<String, Object>> validate(String account, String owner, String batch, long now) {
        return jdbc.queryForList("""
            SELECT s.task_id AS id,s.occurrence,s.title,s.due_date AS dueDate,s.due_time AS dueTime,
              (SELECT json_extract(r.data,'$.Note') FROM hitlist_storage_rows r WHERE r.table_name='KaizenTasks' AND r.owner_id=s.owner_id AND r.entity_key=s.task_id) AS note
            FROM hitlist_due_schedule s JOIN hitlist_due_delivery d
              ON d.owner_id=s.owner_id AND d.task_id=s.task_id AND d.occurrence=s.occurrence
            WHERE d.account_id=? AND d.owner_id=? AND d.batch_id=? AND d.sent=0 AND d.retry_at>? AND s.due_at<=?
            ORDER BY s.due_at,s.task_id LIMIT 20
            """, account, owner, batch, now, now);
    }

    @Transactional
    public void finish(String account, String owner, String batch, List<Map<String, Object>> tasks, boolean sent, long now) {
        for (Map<String, Object> task : tasks) {
            jdbc.update("""
                UPDATE hitlist_due_delivery SET sent=?,retry_at=? WHERE account_id=? AND owner_id=?
                AND task_id=? AND occurrence=? AND batch_id=? AND sent=0
                """, sent ? 1 : 0, now + 60_000, account, owner, task.get("id"), task.get("occurrence"), batch);
        }
    }

    private static String text(Map<String, Object> row, String field) {
        return row.get(field) == null ? "" : String.valueOf(row.get(field));
    }
}