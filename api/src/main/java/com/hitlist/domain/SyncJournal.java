package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/**
 * Notes every change this device makes to a shared workspace's lists and tasks, so the desktop can send it to the other
 * members. Called by {@link EntityRepository} for every write, in the same transaction, so a change is never saved without
 * also being queued. Personal data is never journaled, and neither are changes that came from another member (those are
 * applied with {@link #applyingRemote}).
 *
 * Only the fields that mean the same thing on every member's computer are shared (title, status, dates, list, order,
 * assignee...). Links to a person's own notes or database rows stay on their machine.
 */
@Component
public class SyncJournal {
    public static final Map<String, Set<String>> SHARED_FIELDS = Map.of(
        StorageTables.TASKS, Set.of("Title", "Status", "Quadrant", "TaskPriority", "Note", "DueDate", "DueTime", "Category", "ListId",
            "TaskOrder", "ReminderEnabled", "ReminderMinutesBefore", "Recurrence", "CompletedAt", "CreatedAt", "UpdatedAt",
            "AssigneeUserId", "AssigneeName", "AssignedBy", "AssignedAt"),
        StorageTables.LISTS, Set.of("Name", "Color", "ListOrder", "CreatedAt", "UpdatedAt")
    );
    /** The table names the cloud uses for these. */
    public static final Map<String, String> WIRE_NAMES = Map.of(StorageTables.TASKS, "tasks", StorageTables.LISTS, "lists");

    private static final ThreadLocal<Boolean> REMOTE = ThreadLocal.withInitial(() -> false);
    private final RowStore store;
    private final ObjectMapper json;
    private final AtomicLong clock = new AtomicLong();

    public SyncJournal(RowStore store, ObjectMapper json) {
        this.store = store;
        this.json = json;
    }

    /** Runs {@code work} as the application of another member's changes: nothing it writes is queued to be sent back. */
    public <T> T applyingRemote(java.util.function.Supplier<T> work) {
        boolean before = REMOTE.get();
        REMOTE.set(true);
        try {
            return work.get();
        } finally {
            REMOTE.set(before);
        }
    }

    public boolean isShared(String owner) {
        return !store.findByOwner(StorageTables.WORKSPACE_INFO, owner).isEmpty();
    }

    void inserted(String table, String owner, Map<String, Object> row) {
        if (!tracked(table, owner)) return;
        Map<String, Object> fields = shared(table, row);
        if (!fields.isEmpty()) queue(owner, op(table, id(table, row), fields, false));
    }

    void replaced(String table, String owner, Map<String, Object> before, Map<String, Object> after) {
        if (!tracked(table, owner)) return;
        Map<String, Object> changed = new LinkedHashMap<>();
        shared(table, after).forEach((key, value) -> {
            if (!Objects.equals(normal(before.get(key)), normal(value))) changed.put(key, value);
        });
        // Fields that were cleared are sent as empty, so the other copies clear them too.
        for (String key : SHARED_FIELDS.get(table)) {
            if (before.containsKey(key) && !after.containsKey(key)) changed.put(key, "");
        }
        if (!changed.isEmpty()) queue(owner, op(table, id(table, after), changed, false));
    }

    void deleted(String table, String owner, Map<String, Object> row) {
        if (!tracked(table, owner)) return;
        queue(owner, op(table, id(table, row), Map.of(), true));
    }

    /** Ops waiting to be sent, oldest first. */
    public List<Map<String, Object>> pending(String workspaceId, int limit) {
        return store.findByOwner(StorageTables.SYNC_OUTBOX, workspaceId).stream()
            .sorted(java.util.Comparator.comparingLong(row -> Values.number(row.get("Seq"), 0)))
            .limit(limit)
            .toList();
    }

    /** Fields of an entity that have changes waiting to be sent: a remote change must not overwrite them yet. */
    public Set<String> pendingFields(String workspaceId, String wireTable, String entityId) {
        Set<String> out = new java.util.HashSet<>();
        for (Map<String, Object> row : store.findByOwner(StorageTables.SYNC_OUTBOX, workspaceId)) {
            Map<String, Object> op = parse(row.get("Op"));
            if (wireTable.equals(op.get("table")) && entityId.equals(op.get("id"))) {
                if (Boolean.TRUE.equals(op.get("deleted"))) out.add("*");
                if (op.get("fields") instanceof Map<?, ?> fields) fields.keySet().forEach(k -> out.add(String.valueOf(k)));
            }
        }
        return out;
    }

    public int acknowledge(String workspaceId, Set<String> opIds) {
        int removed = 0;
        for (Map<String, Object> row : store.findByOwner(StorageTables.SYNC_OUTBOX, workspaceId)) {
            if (opIds.contains(EntityRepository.text(row.get("OpId")))) {
                store.delete(StorageTables.SYNC_OUTBOX, EntityRepository.text(row.get("ROWID")));
                removed++;
            }
        }
        return removed;
    }

    public Map<String, Object> parse(Object value) {
        try {
            return value == null ? Map.of() : json.readValue(String.valueOf(value), new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() { });
        } catch (JsonProcessingException e) {
            return Map.of();
        }
    }

    private boolean tracked(String table, String owner) {
        return SHARED_FIELDS.containsKey(table) && !REMOTE.get() && isShared(owner);
    }

    private static Map<String, Object> shared(String table, Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String key : SHARED_FIELDS.get(table)) {
            if (row.containsKey(key)) out.put(key, row.get(key));
        }
        return out;
    }

    private static Object normal(Object value) {
        return value instanceof Number n ? (Object) n.doubleValue() : value == null ? "" : value;
    }

    private static String id(String table, Map<String, Object> row) {
        return EntityRepository.text(row.get(StorageTables.primaryKey(table)));
    }

    private static Map<String, Object> op(String table, String id, Map<String, Object> fields, boolean deleted) {
        Map<String, Object> op = new LinkedHashMap<>();
        op.put("table", WIRE_NAMES.get(table));
        op.put("id", id);
        if (deleted) op.put("deleted", true);
        else op.put("fields", fields);
        return op;
    }

    private void queue(String owner, Map<String, Object> op) {
        long seq = clock.updateAndGet(last -> Math.max(last + 1, System.currentTimeMillis() * 1000));
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("OwnerId", owner);
        row.put("OpId", UUID.randomUUID().toString());
        row.put("Seq", seq);
        try {
            row.put("Op", json.writeValueAsString(op));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("could not queue a shared change", e);
        }
        store.insert(StorageTables.SYNC_OUTBOX, row);
    }
}
