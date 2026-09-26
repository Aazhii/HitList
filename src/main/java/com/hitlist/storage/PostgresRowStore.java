package com.hitlist.storage;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.web.ApiException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

public class PostgresRowStore implements RowStore {
    private static final TypeReference<LinkedHashMap<String, Object>> ROW_TYPE = new TypeReference<>() { };
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public PostgresRowStore(DataSource dataSource, ObjectMapper objectMapper) {
        this.jdbc = new JdbcTemplate(dataSource);
        this.objectMapper = objectMapper;
        initialize();
    }

    private void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS hitlist_storage_rows (
              row_id VARCHAR(64) PRIMARY KEY,
              table_name VARCHAR(64) NOT NULL,
              owner_id VARCHAR(64) NOT NULL DEFAULT '',
              entity_key VARCHAR(255) NOT NULL DEFAULT '',
              data TEXT NOT NULL,
              created_at BIGINT NOT NULL
            )
            """);
        jdbc.execute("CREATE INDEX IF NOT EXISTS hitlist_storage_rows_table_owner_idx ON hitlist_storage_rows (table_name, owner_id)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS hitlist_storage_rows_table_created_idx ON hitlist_storage_rows (table_name, created_at)");
        jdbc.execute("DROP INDEX IF EXISTS hitlist_storage_rows_entity_unique");
        jdbc.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS hitlist_storage_rows_owner_entity_unique
            ON hitlist_storage_rows (table_name, owner_id, entity_key) WHERE entity_key <> ''
            """);
    }

    @Override
    public List<Map<String, Object>> findByOwner(String table, String ownerId) {
        StorageTables.primaryKey(table);
        return jdbc.query(
            "SELECT row_id, data FROM hitlist_storage_rows WHERE table_name = ? AND owner_id = ?",
            (resultSet, rowNumber) -> rowWithId(resultSet.getString("row_id"), resultSet.getString("data")),
            table,
            ownerId
        );
    }

    @Override
    public Map<String, Object> insert(String table, Map<String, Object> row) {
        String rowId = UUID.randomUUID().toString();
        String entityKey = String.valueOf(row.getOrDefault(StorageTables.primaryKey(table), ""));
        jdbc.update(
            """
            INSERT INTO hitlist_storage_rows (row_id, table_name, owner_id, entity_key, data, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rowId, table, String.valueOf(row.getOrDefault("OwnerId", "")), entityKey, json(row), System.currentTimeMillis()
        );
        Map<String, Object> inserted = new LinkedHashMap<>(row);
        inserted.put("ROWID", rowId);
        return inserted;
    }

    @Override
    public Map<String, Object> update(String table, String rowId, Map<String, Object> row) {
        int updated = jdbc.update(
            """
            UPDATE hitlist_storage_rows
            SET owner_id = ?, entity_key = ?, data = ?
            WHERE table_name = ? AND row_id = ?
            """,
            String.valueOf(row.getOrDefault("OwnerId", "")),
            String.valueOf(row.getOrDefault(StorageTables.primaryKey(table), "")),
            json(row),
            table,
            rowId
        );
        if (updated != 1) {
            throw ApiException.notFound();
        }
        Map<String, Object> saved = new LinkedHashMap<>(row);
        saved.put("ROWID", rowId);
        return saved;
    }

    @Override
    public void delete(String table, String rowId) {
        jdbc.update("DELETE FROM hitlist_storage_rows WHERE table_name = ? AND row_id = ?", table, rowId);
    }

    @Override
    public String mode() {
        return "postgres";
    }

    private Map<String, Object> rowWithId(String rowId, String data) {
        try {
            Map<String, Object> row = objectMapper.readValue(data, ROW_TYPE);
            row.put("ROWID", rowId);
            return row;
        } catch (JsonProcessingException exception) {
            throw ApiException.unavailable("Local storage contains an unreadable record");
        }
    }

    private String json(Map<String, Object> row) {
        try {
            Map<String, Object> copy = new LinkedHashMap<>(row);
            copy.remove("ROWID");
            return objectMapper.writeValueAsString(copy);
        } catch (JsonProcessingException exception) {
            throw ApiException.invalid("The supplied record cannot be stored");
        }
    }
}
