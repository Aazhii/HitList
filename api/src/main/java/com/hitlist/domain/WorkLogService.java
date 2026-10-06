package com.hitlist.domain;

import com.hitlist.storage.StorageTables;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The progress log: one short line per thing that moved ("discussed with @naga, still open"), kept
 * so the Monday update can say what happened, finished or not. Rows are plain entries in the generic
 * store, per owner; nothing here touches tasks, notes or databases, and the log is not synced.
 */
@Service
public class WorkLogService {
    static final Set<String> STATES = Set.of("moved", "blocked", "discussed", "done");
    static final int MAX_TEXT = 500;
    static final int MAX_ENTRIES = 5000;

    private final EntityRepository repository;

    public WorkLogService(EntityRepository repository) {
        this.repository = repository;
    }

    /** Entries whose time falls in [from, to], oldest first. A missing bound is open. */
    public List<Map<String, Object>> list(String owner, long from, long to) {
        return repository.list(StorageTables.WORK_LOG, owner).stream()
            .filter(row -> {
                long at = Values.number(row.get("At"), 0);
                return at >= from && at <= to;
            })
            .sorted(Comparator.comparingLong((Map<String, Object> row) -> Values.number(row.get("At"), 0))
                .thenComparingLong(row -> Values.number(row.get("CreatedAt"), 0)))
            .map(WorkLogService::api)
            .toList();
    }

    public Map<String, Object> create(String owner, Map<String, Object> body) {
        String clientId = Values.optional(body, "clientId", 64, "");
        if (!clientId.isBlank()) Values.id(clientId);
        String id = clientId.isBlank() ? UUID.randomUUID().toString() : clientId;
        // A retried save of the same entry is the same entry, not a second line.
        var existing = repository.find(StorageTables.WORK_LOG, owner, id);
        if (existing.isPresent()) return api(existing.get());
        if (repository.list(StorageTables.WORK_LOG, owner).size() >= MAX_ENTRIES) {
            throw com.hitlist.web.ApiException.invalid("the progress log is full (" + MAX_ENTRIES + " entries)");
        }
        long now = System.currentTimeMillis();
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("EntryId", id);
        row.put("Text", Values.required(body, "text", MAX_TEXT));
        row.put("State", Values.optional(body, "state", 16, "moved"));
        checkState(row);
        row.put("At", Values.optionalTimestamp(body, "at", now));
        row.put("Section", Values.optional(body, "section", 64, ""));
        row.put("TaskId", ref(body, "taskId"));
        row.put("NoteId", ref(body, "noteId"));
        row.put("RecordId", ref(body, "recordId"));
        row.put("CreatedAt", now);
        row.put("UpdatedAt", now);
        repository.insert(StorageTables.WORK_LOG, owner, row);
        return api(row);
    }

    public Map<String, Object> update(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> row = new LinkedHashMap<>(repository.require(StorageTables.WORK_LOG, owner, id));
        if (body.containsKey("text")) row.put("Text", Values.required(body, "text", MAX_TEXT));
        if (body.containsKey("state")) {
            row.put("State", Values.optional(body, "state", 16, "moved"));
            checkState(row);
        }
        if (body.containsKey("at")) row.put("At", Values.optionalTimestamp(body, "at", Values.number(row.get("At"), 0)));
        if (body.containsKey("section")) row.put("Section", Values.optional(body, "section", 64, ""));
        row.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.WORK_LOG, owner, id, row);
        return api(row);
    }

    public void delete(String owner, String id) {
        Values.id(id);
        repository.delete(StorageTables.WORK_LOG, owner, id);
    }

    private static void checkState(Map<String, Object> row) {
        if (!STATES.contains(EntityRepository.text(row.get("State")))) {
            throw com.hitlist.web.ApiException.invalid("state must be one of " + String.join(", ", new java.util.TreeSet<>(STATES)));
        }
    }

    private static String ref(Map<String, Object> body, String field) {
        String value = Values.optional(body, field, 64, "");
        if (!value.isBlank()) Values.id(value);
        return value;
    }

    private static Map<String, Object> api(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", EntityRepository.text(row.get("EntryId")));
        out.put("text", EntityRepository.text(row.get("Text")));
        out.put("state", EntityRepository.text(row.get("State")));
        out.put("at", Values.number(row.get("At"), 0));
        out.put("section", EntityRepository.text(row.get("Section")));
        out.put("taskId", EntityRepository.text(row.get("TaskId")));
        out.put("noteId", EntityRepository.text(row.get("NoteId")));
        out.put("recordId", EntityRepository.text(row.get("RecordId")));
        out.put("createdAt", Values.number(row.get("CreatedAt"), 0));
        out.put("updatedAt", Values.number(row.get("UpdatedAt"), 0));
        return out;
    }
}
