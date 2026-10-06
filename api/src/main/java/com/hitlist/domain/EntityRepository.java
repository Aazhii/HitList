package com.hitlist.domain;

import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class EntityRepository {
    private final RowStore store;
    private final SyncJournal journal;
    private com.hitlist.storage.DueScheduleStore schedules;

    @org.springframework.beans.factory.annotation.Autowired
    public void setSchedules(com.hitlist.storage.DueScheduleStore schedules) {
        this.schedules = schedules;
    }

    /** For tests and tools that build a repository by hand. */
    public EntityRepository(RowStore store) {
        this(store, new SyncJournal(store, new com.fasterxml.jackson.databind.ObjectMapper()));
    }

    @org.springframework.beans.factory.annotation.Autowired
    public EntityRepository(RowStore store, SyncJournal journal) {
        this.store = store;
        this.journal = journal;
    }

    public List<Map<String, Object>> list(String table, String ownerId) {
        return store.findByOwner(table, ownerId);
    }

    public Optional<Map<String, Object>> find(String table, String ownerId, String id) {
        String key = StorageTables.primaryKey(table);
        return list(table, ownerId).stream()
            .filter(row -> id.equals(text(row.get(key))))
            .findFirst();
    }

    public Map<String, Object> require(String table, String ownerId, String id) {
        return find(table, ownerId, id).orElseThrow(ApiException::notFound);
    }

    // Writes run in one transaction with the shared-workspace journal (SyncJournal), so a change to a shared list or task is
    // never saved without also being queued for the other members.
    @Transactional
    public Map<String, Object> insert(String table, String ownerId, Map<String, Object> row) {
        Map<String, Object> owned = new LinkedHashMap<>(row);
        owned.put("OwnerId", ownerId);
        Map<String, Object> saved = store.insert(table, owned);
        journal.inserted(table, ownerId, owned);
        if (schedules != null && StorageTables.TASKS.equals(table)) schedules.upsert(ownerId, owned);
        return saved;
    }

    @Transactional
    public Map<String, Object> replace(String table, String ownerId, String id, Map<String, Object> row) {
        Map<String, Object> existing = require(table, ownerId, id);
        Map<String, Object> owned = new LinkedHashMap<>(row);
        owned.put("OwnerId", ownerId);
        owned.put(StorageTables.primaryKey(table), id);
        Map<String, Object> saved = store.update(table, text(existing.get("ROWID")), owned);
        journal.replaced(table, ownerId, existing, owned);
        if (schedules != null && StorageTables.TASKS.equals(table)) schedules.upsert(ownerId, owned);
        return saved;
    }

    @Transactional
    public void delete(String table, String ownerId, String id) {
        Map<String, Object> existing = require(table, ownerId, id);
        store.delete(table, text(existing.get("ROWID")));
        journal.deleted(table, ownerId, existing);
        if (schedules != null && StorageTables.TASKS.equals(table)) schedules.remove(ownerId, id);
    }

    @Transactional
    public void deleteRows(String table, String ownerId, java.util.function.Predicate<Map<String, Object>> predicate) {
        for (Map<String, Object> row : list(table, ownerId)) {
            if (predicate.test(row)) {
                store.delete(table, text(row.get("ROWID")));
                journal.deleted(table, ownerId, row);
                if (schedules != null && StorageTables.TASKS.equals(table)) schedules.remove(ownerId, text(row.get("TaskId")));
            }
        }
    }

    public List<String> owners(String table) {
        return store.owners(table);
    }

    public String mode() {
        return store.mode();
    }

    public static String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
