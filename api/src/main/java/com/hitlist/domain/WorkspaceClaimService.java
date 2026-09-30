package com.hitlist.domain;

import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Brings a browser's old cookie workspace into a signed-in account, the first time that account signs in from
 * that browser. Rows are re-owned, never copied or deleted. A row whose id the account already has stays with the
 * cookie owner, so nothing is overwritten. Once everything has moved there is nothing left to claim, which makes
 * asking again harmless.
 */
@Service
public class WorkspaceClaimService {
    private static final List<String> TABLES = List.of(
        StorageTables.LISTS, StorageTables.TASKS, StorageTables.NOTES, StorageTables.VIEWS, StorageTables.DATABASES,
        StorageTables.FIELD_DEFS, StorageTables.DATABASE_ROWS, StorageTables.FIELD_VALUES, StorageTables.RULES,
        StorageTables.FAVORITES, StorageTables.RECENTS, StorageTables.NOTIFICATIONS, StorageTables.RUNS,
        StorageTables.QUEUE, StorageTables.CALENDAR_CONNECTIONS
    );
    private final EntityRepository repository;
    private final RowStore store;

    public WorkspaceClaimService(EntityRepository repository, RowStore store) {
        this.repository = repository;
        this.store = store;
    }

    /** Returns how many rows moved, per table that had any. */
    @Transactional
    public Map<String, Integer> claim(String fromOwner, String toOwner) {
        Map<String, Integer> moved = new LinkedHashMap<>();
        if (fromOwner == null || fromOwner.equals(toOwner)) return moved;
        for (String table : TABLES) {
            List<Map<String, Object>> legacy = repository.list(table, fromOwner);
            if (legacy.isEmpty()) continue;
            String key = StorageTables.primaryKey(table);
            Set<String> taken = new HashSet<>();
            repository.list(table, toOwner).forEach(row -> taken.add(EntityRepository.text(row.get(key))));
            int count = 0;
            for (Map<String, Object> row : legacy) {
                if (taken.contains(EntityRepository.text(row.get(key)))) continue;
                Map<String, Object> next = new LinkedHashMap<>(row);
                next.put("OwnerId", toOwner);
                store.update(table, EntityRepository.text(row.get("ROWID")), next);
                count++;
            }
            if (count > 0) moved.put(table, count);
        }
        return moved;
    }
}
