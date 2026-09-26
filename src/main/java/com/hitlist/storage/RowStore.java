package com.hitlist.storage;

import java.util.List;
import java.util.Map;

public interface RowStore {
    List<Map<String, Object>> findByOwner(String table, String ownerId);

    Map<String, Object> insert(String table, Map<String, Object> row);

    Map<String, Object> update(String table, String rowId, Map<String, Object> row);

    void delete(String table, String rowId);

    String mode();
}
