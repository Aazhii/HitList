package com.hitlist.storage;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The automation engine's stored work: what must run, and when ("execute at"), plus what other parts of the app still have to
 * send on its behalf. Local (SQLite) only, like {@link DueScheduleStore}: automations run only while HitList is open.
 *
 * <ul>
 *   <li><b>hitlist_automation_queue</b>: one row per (rule, item, moment). A row is runnable once {@code now >= execute_at}. It is
 *       claimed with a lease, finished as done/skipped, or released back when the lease runs out (the app crashed mid-run).
 *       The row's key is also what stops a moment running twice.</li>
 *   <li><b>hitlist_automation_seen</b>: the last values seen for items a rule watches, so "added" and "edited" are found by
 *       comparison. A rule's first look only records.</li>
 *   <li><b>hitlist_action_outbox</b>: messages for the desktop to deliver (Cliq). Reserved with a lease, then acknowledged or
 *       retried, the same protocol as the overdue alerts.</li>
 * </ul>
 */
@Component
public class AutomationQueue {
    public static final long LEASE_MS = 120_000;
    public static final int MAX_ATTEMPTS = 5;
    public static final long RETRY_MS = 60_000;

    private final JdbcTemplate jdbc;
    private final boolean local;

    public AutomationQueue(DataSource source, RowStore rows) {
        jdbc = new JdbcTemplate(java.util.Objects.requireNonNull(source));
        local = "sqlite".equals(rows.mode());
        if (!local) return;
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS hitlist_automation_queue (
              owner_id TEXT NOT NULL, rule_id TEXT NOT NULL, subject_id TEXT NOT NULL, occurrence TEXT NOT NULL,
              execute_at BIGINT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
              lease_until BIGINT NOT NULL DEFAULT 0, payload TEXT NOT NULL DEFAULT '{}',
              created_at BIGINT NOT NULL, finished_at BIGINT NOT NULL DEFAULT 0,
              PRIMARY KEY (owner_id, rule_id, subject_id, occurrence))
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS hitlist_automation_queue_due_idx ON hitlist_automation_queue(state, execute_at)");
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS hitlist_automation_seen (
              owner_id TEXT NOT NULL, rule_id TEXT NOT NULL, subject_id TEXT NOT NULL, snapshot TEXT NOT NULL,
              PRIMARY KEY (owner_id, rule_id, subject_id))
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS hitlist_action_outbox (
              outbox_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, rule_id TEXT NOT NULL, run_id TEXT NOT NULL,
              action TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
              batch_id TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
              not_before BIGINT NOT NULL DEFAULT 0, retry_at BIGINT NOT NULL DEFAULT 0,
              created_at BIGINT NOT NULL, finished_at BIGINT NOT NULL DEFAULT 0)
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS hitlist_action_outbox_due_idx ON hitlist_action_outbox(owner_id, state, not_before)");
    }

    /** False outside SQLite (the old hosted path), where the engine falls back to computing moments on each sweep. */
    public boolean enabled() {
        return local;
    }

    // ── the queue ─────────────────────────────────────────────────────────────────────────────────────────────────────

    /** Adds a moment to run. A moment that is already there (in any state) is left alone. Returns whether it was new. */
    public synchronized boolean enqueue(String owner, String rule, String subject, String occurrence, long executeAt, String payload, long now) {
        return jdbc.update("""
            INSERT INTO hitlist_automation_queue(owner_id,rule_id,subject_id,occurrence,execute_at,payload,created_at)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,rule_id,subject_id,occurrence) DO NOTHING
            """, owner, rule, subject, occurrence, executeAt, payload, now) > 0;
    }

    /** Puts runnable rows (execute_at has come, not claimed) under a lease and returns them, oldest first. */
    public synchronized List<Map<String, Object>> claim(long now, int limit) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            SELECT owner_id AS owner, rule_id AS rule, subject_id AS subject, occurrence, execute_at AS executeAt, payload, attempts
            FROM hitlist_automation_queue WHERE state='pending' AND execute_at<=? ORDER BY execute_at, rule_id, subject_id LIMIT ?
            """, now, limit);
        for (Map<String, Object> row : rows) {
            jdbc.update("""
                UPDATE hitlist_automation_queue SET state='claimed', lease_until=?, attempts=attempts+1
                WHERE owner_id=? AND rule_id=? AND subject_id=? AND occurrence=?
                """, now + LEASE_MS, row.get("owner"), row.get("rule"), row.get("subject"), row.get("occurrence"));
        }
        return rows;
    }

    /** Marks a claimed row finished ('done', 'skipped' or 'failed'). */
    public synchronized void finish(String owner, String rule, String subject, String occurrence, String state, long now) {
        jdbc.update("""
            UPDATE hitlist_automation_queue SET state=?, finished_at=?, lease_until=0
            WHERE owner_id=? AND rule_id=? AND subject_id=? AND occurrence=?
            """, state, now, owner, rule, subject, occurrence);
    }

    /** Rows whose lease ran out (the app stopped mid-run) go back to pending, or fail after too many tries. Returns the failed ones. */
    public synchronized List<Map<String, Object>> releaseExpired(long now) {
        List<Map<String, Object>> failed = jdbc.queryForList("""
            SELECT owner_id AS owner, rule_id AS rule, subject_id AS subject, occurrence FROM hitlist_automation_queue
            WHERE state='claimed' AND lease_until<=? AND attempts>=?
            """, now, MAX_ATTEMPTS);
        jdbc.update("UPDATE hitlist_automation_queue SET state='failed', finished_at=?, lease_until=0 WHERE state='claimed' AND lease_until<=? AND attempts>=?",
            now, now, MAX_ATTEMPTS);
        jdbc.update("UPDATE hitlist_automation_queue SET state='pending', lease_until=0 WHERE state='claimed' AND lease_until<=?", now);
        return failed;
    }

    /** Finished rows older than `before` are removed; the moments they guarded have long passed. */
    public synchronized void prune(long before) {
        jdbc.update("DELETE FROM hitlist_automation_queue WHERE state IN ('done','skipped','failed') AND finished_at>0 AND finished_at<?", before);
        jdbc.update("DELETE FROM hitlist_action_outbox WHERE state IN ('sent','failed') AND finished_at>0 AND finished_at<?", before);
    }

    public synchronized void deleteRule(String owner, String rule) {
        jdbc.update("DELETE FROM hitlist_automation_queue WHERE owner_id=? AND rule_id=?", owner, rule);
        jdbc.update("DELETE FROM hitlist_automation_seen WHERE owner_id=? AND rule_id=?", owner, rule);
        jdbc.update("DELETE FROM hitlist_action_outbox WHERE owner_id=? AND rule_id=? AND state<>'sent'", owner, rule);
    }

    public boolean exists(String owner, String rule, String subject, String occurrence) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM hitlist_automation_queue WHERE owner_id=? AND rule_id=? AND subject_id=? AND occurrence=?",
            Long.class, owner, rule, subject, occurrence);
        return n != null && n > 0;
    }

    /** Waiting or running rows for a rule: what "pending work" means in the UI. */
    public long waiting(String owner, String rule) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM hitlist_automation_queue WHERE owner_id=? AND rule_id=? AND state IN ('pending','claimed')", Long.class, owner, rule);
        return n == null ? 0 : n;
    }

    public List<Map<String, Object>> rows(String owner, String rule) {
        return jdbc.queryForList("""
            SELECT subject_id AS subject, occurrence, execute_at AS executeAt, state, attempts
            FROM hitlist_automation_queue WHERE owner_id=? AND rule_id=? ORDER BY execute_at, subject_id
            """, owner, rule);
    }

    // ── what a rule has already seen ──────────────────────────────────────────────────────────────────────────────────

    public Map<String, String> seen(String owner, String rule) {
        Map<String, String> out = new java.util.LinkedHashMap<>();
        jdbc.query("SELECT subject_id, snapshot FROM hitlist_automation_seen WHERE owner_id=? AND rule_id=?", rs -> {
            out.put(rs.getString(1), rs.getString(2));
        }, owner, rule);
        return out;
    }

    public synchronized void putSeen(String owner, String rule, String subject, String snapshot) {
        jdbc.update("""
            INSERT INTO hitlist_automation_seen(owner_id,rule_id,subject_id,snapshot) VALUES (?,?,?,?)
            ON CONFLICT(owner_id,rule_id,subject_id) DO UPDATE SET snapshot=excluded.snapshot
            """, owner, rule, subject, snapshot);
    }

    public synchronized void removeSeen(String owner, String rule, String subject) {
        jdbc.update("DELETE FROM hitlist_automation_seen WHERE owner_id=? AND rule_id=? AND subject_id=?", owner, rule, subject);
    }

    // ── the outbox (messages the desktop delivers) ────────────────────────────────────────────────────────────────────

    public synchronized String addOutbox(String owner, String rule, String runId, String action, String payload, long notBefore, long now) {
        String id = UUID.randomUUID().toString();
        jdbc.update("""
            INSERT INTO hitlist_action_outbox(outbox_id,owner_id,rule_id,run_id,action,payload,not_before,created_at) VALUES (?,?,?,?,?,?,?,?)
            """, id, owner, rule, runId, action, payload, notBefore, now);
        return id;
    }

    /** Messages that may go now (not held for quiet hours, not already reserved), reserved under a lease. */
    public synchronized Map<String, Object> reserveOutbox(String owner, String action, long now, int limit) {
        String batch = UUID.randomUUID().toString();
        List<Map<String, Object>> items = jdbc.queryForList("""
            SELECT outbox_id AS id, rule_id AS ruleId, run_id AS runId, payload, attempts FROM hitlist_action_outbox
            WHERE owner_id=? AND action=? AND not_before<=? AND ((state='pending' AND retry_at<=?) OR (state='claimed' AND retry_at<=?))
            ORDER BY created_at LIMIT ?
            """, owner, action, now, now, now, limit);
        for (Map<String, Object> item : items) {
            jdbc.update("UPDATE hitlist_action_outbox SET state='claimed', batch_id=?, retry_at=?, attempts=attempts+1 WHERE outbox_id=?",
                batch, now + LEASE_MS, item.get("id"));
        }
        return Map.of("batchId", batch, "items", items);
    }

    /** Items of a batch that are still reserved (the lease has not run out). */
    public List<Map<String, Object>> reservedOutbox(String owner, String batch, long now) {
        return jdbc.queryForList("""
            SELECT outbox_id AS id, rule_id AS ruleId, payload FROM hitlist_action_outbox
            WHERE owner_id=? AND batch_id=? AND state='claimed' AND retry_at>? ORDER BY created_at
            """, owner, batch, now);
    }

    /** Sent = done. Otherwise the message goes back to be retried after a minute, and is given up after MAX_ATTEMPTS. */
    public synchronized void finishOutbox(String owner, String batch, List<String> ids, boolean sent, long now) {
        for (String id : ids) {
            if (sent) {
                jdbc.update("UPDATE hitlist_action_outbox SET state='sent', finished_at=? WHERE owner_id=? AND outbox_id=? AND batch_id=? AND state='claimed'", now, owner, id, batch);
            } else {
                jdbc.update("""
                    UPDATE hitlist_action_outbox SET state=CASE WHEN attempts>=? THEN 'failed' ELSE 'pending' END, retry_at=?, finished_at=CASE WHEN attempts>=? THEN ? ELSE 0 END
                    WHERE owner_id=? AND outbox_id=? AND batch_id=? AND state='claimed'
                    """, MAX_ATTEMPTS, now + RETRY_MS, MAX_ATTEMPTS, now, owner, id, batch);
            }
        }
    }

    /** Messages created by a rule since `since` (for its daily cap), whatever happened to them. */
    public long outboxSince(String owner, String rule, String action, long since) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM hitlist_action_outbox WHERE owner_id=? AND rule_id=? AND action=? AND created_at>=? AND state<>'failed'",
            Long.class, owner, rule, action, since);
        return n == null ? 0 : n;
    }

    public List<Map<String, Object>> outboxFor(String owner, String rule) {
        return jdbc.queryForList("SELECT outbox_id AS id, state, attempts, not_before AS notBefore, payload FROM hitlist_action_outbox WHERE owner_id=? AND rule_id=? ORDER BY created_at", owner, rule);
    }
}
