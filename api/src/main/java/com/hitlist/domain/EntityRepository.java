package com.hitlist.domain;

import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class EntityRepository {
    private final RowStore store;

    public EntityRepository(RowStore store) {
        this.store = store;
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

    public Map<String, Object> insert(String table, String ownerId, Map<String, Object> row) {
        Map<String, Object> owned = new LinkedHashMap<>(row);
        owned.put("OwnerId", ownerId);
        return store.insert(table, owned);
    }

    public Map<String, Object> replace(String table, String ownerId, String id, Map<String, Object> row) {
        Map<String, Object> existing = require(table, ownerId, id);
        Map<String, Object> owned = new LinkedHashMap<>(row);
        owned.put("OwnerId", ownerId);
        owned.put(StorageTables.primaryKey(table), id);
        return store.update(table, text(existing.get("ROWID")), owned);
    }

    public void delete(String table, String ownerId, String id) {
        Map<String, Object> existing = require(table, ownerId, id);
        store.delete(table, text(existing.get("ROWID")));
    }

    public void deleteRows(String table, String ownerId, java.util.function.Predicate<Map<String, Object>> predicate) {
        for (Map<String, Object> row : list(table, ownerId)) {
            if (predicate.test(row)) {
                store.delete(table, text(row.get("ROWID")));
            }
        }
    }

    public String mode() {
        return store.mode();
    }

    public static String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
