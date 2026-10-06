package com.hitlist.domain;

import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * A person's whole workspace as one file, and back again (P6.4).
 *
 * The file is the stored rows themselves, so nothing is lost on the way out: recurrence, reminders, custom
 * fields, inline databases, automation rules and favourites all travel. Import only ever adds. A row whose
 * id already exists in the workspace is left exactly as it is, so importing a file never overwrites or deletes
 * anything — importing the same file twice adds nothing the second time. A task that says the same as one already here
 * (title, list, due day, quadrant) is not added again under a different id.
 *
 * Deliberately left out of the file: Zoho Calendar connections (they hold credentials), notifications and their
 * queue (history, not content), and automation run records (they are what stops a rule from firing twice).
 */
@Service
public class WorkspaceBackupService {
    public static final String SCHEMA = "hitlist.backup.v1";

    /** What goes in the file, in the order rows are restored (a list before its tasks, and so on). */
    static final List<String> TABLES = List.of(
        StorageTables.LISTS,
        StorageTables.TASKS,
        StorageTables.NOTES,
        StorageTables.VIEWS,
        StorageTables.DATABASES,
        StorageTables.FIELD_DEFS,
        StorageTables.DATABASE_ROWS,
        StorageTables.FIELD_VALUES,
        StorageTables.RULES,
        StorageTables.FAVORITES,
        StorageTables.RECENTS,
        StorageTables.WORK_LOG
    );

    /** A text field each kind of row must have, so a hand-edited file cannot add something the app cannot read. */
    private static final Map<String, String> REQUIRED_TEXT = Map.of(
        StorageTables.LISTS, "Name",
        StorageTables.TASKS, "Title",
        StorageTables.NOTES, "Title",
        StorageTables.VIEWS, "Name",
        StorageTables.DATABASES, "Name"
    );
    private static final Set<String> STORE_KEYS = Set.of("OwnerId", "ROWID");
    private static final int MAX_ROWS = 500_000;
    private static final int MAX_ID_LENGTH = 200;

    private final EntityRepository repository;

    public WorkspaceBackupService(EntityRepository repository) {
        this.repository = repository;
    }

    public Map<String, Object> export(String owner) {
        Map<String, Object> tables = new LinkedHashMap<>();
        Map<String, Object> counts = new LinkedHashMap<>();
        for (String table : TABLES) {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (Map<String, Object> row : repository.list(table, owner)) {
                Map<String, Object> clean = new LinkedHashMap<>(row);
                STORE_KEYS.forEach(clean::remove);
                rows.add(clean);
            }
            tables.put(table, rows);
            counts.put(table, rows.size());
        }
        Map<String, Object> file = new LinkedHashMap<>();
        file.put("schema", SCHEMA);
        file.put("exportedAt", Instant.now().toString());
        file.put("counts", counts);
        file.put("tables", tables);
        return file;
    }

    @Transactional
    public Map<String, Object> importBackup(String owner, Map<String, Object> file) {
        if (!SCHEMA.equals(file.get("schema"))) {
            throw ApiException.invalid("This is not a HitList backup (schema must be " + SCHEMA + ")");
        }
        if (!(file.get("tables") instanceof Map<?, ?> given)) {
            throw ApiException.invalid("tables must be an object");
        }
        for (Object name : given.keySet()) {
            if (!TABLES.contains(String.valueOf(name))) {
                throw ApiException.invalid("Unknown table in backup: " + name);
            }
        }

        // Validate everything before writing anything, so a bad file changes nothing.
        Map<String, List<Map<String, Object>>> toRead = new LinkedHashMap<>();
        int total = 0;
        for (String table : TABLES) {
            Object raw = given.get(table);
            if (raw == null) continue;
            if (!(raw instanceof List<?> rows)) throw ApiException.invalid(table + " must be a list");
            String key = StorageTables.primaryKey(table);
            String required = REQUIRED_TEXT.get(table);
            List<Map<String, Object>> clean = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (Object item : rows) {
                if (!(item instanceof Map<?, ?> map)) throw ApiException.invalid(table + " has a row that is not an object");
                Map<String, Object> row = new LinkedHashMap<>();
                map.forEach((k, v) -> row.put(String.valueOf(k), v));
                STORE_KEYS.forEach(row::remove);
                String id = EntityRepository.text(row.get(key));
                if (id.isBlank() || id.length() > MAX_ID_LENGTH) throw ApiException.invalid(table + " has a row without a usable " + key);
                if (required != null && !(row.get(required) instanceof String)) {
                    throw ApiException.invalid(table + " row " + id + " needs a text " + required);
                }
                if (seen.add(id)) clean.add(row);
            }
            total += clean.size();
            if (total > MAX_ROWS) throw ApiException.invalid("The backup has too many rows");
            toRead.put(table, clean);
        }

        Map<String, Object> imported = new LinkedHashMap<>();
        Map<String, Object> skipped = new LinkedHashMap<>();
        for (String table : TABLES) {
            List<Map<String, Object>> rows = toRead.get(table);
            if (rows == null) continue;
            String key = StorageTables.primaryKey(table);
            Set<String> existing = new HashSet<>();
            repository.list(table, owner).forEach(row -> existing.add(EntityRepository.text(row.get(key))));
            // A task that says the same thing as one already here (same words, list, day and quadrant) is that task under
            // another id, which is what a reinstall or a backup taken from a second copy produces. Matching is by count,
            // so a backup with three identical tasks next to one existing adds two.
            Map<String, Integer> alreadyHere = new HashMap<>();
            if (StorageTables.TASKS.equals(table)) {
                repository.list(table, owner).forEach(row -> alreadyHere.merge(sameTask(row), 1, Integer::sum));
            }
            int added = 0;
            for (Map<String, Object> row : rows) {
                if (existing.contains(EntityRepository.text(row.get(key)))) continue;
                if (StorageTables.TASKS.equals(table)) {
                    String same = sameTask(row);
                    Integer left = alreadyHere.get(same);
                    if (left != null && left > 0) { alreadyHere.put(same, left - 1); continue; }
                }
                repository.insert(table, owner, row);
                added++;
            }
            imported.put(table, added);
            skipped.put(table, rows.size() - added);
        }
        return Map.of("ok", true, "imported", imported, "skipped", skipped);
    }

    private static String sameTask(Map<String, Object> task) {
        return String.join("\u0001",
            EntityRepository.text(task.get("Title")).trim().toLowerCase(java.util.Locale.ROOT),
            EntityRepository.text(task.get("ListId")),
            EntityRepository.text(task.get("DueDate")),
            EntityRepository.text(task.get("Quadrant")));
    }
}
