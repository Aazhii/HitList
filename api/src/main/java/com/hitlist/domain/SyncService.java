package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * This device's copies of shared workspaces.
 *
 * A shared workspace is stored like a personal one, as its own owner partition (its id has the same 43-character shape),
 * so every existing task and list rule applies to it unchanged. Alongside it this keeps: which signed-in accounts on this
 * device belong to it, its members, and how far its change log has been applied (the cursor). The desktop's sync engine
 * calls these endpoints; the web app only reads the workspace list and the assigned tasks.
 *
 * Changes from other members are applied strictly in the cloud's order, so every member's copy ends the same. A field
 * changed here and not yet sent is left alone by an incoming change: the local change goes out next, gets a later number,
 * and wins everywhere.
 */
@Service
public class SyncService {
    private static final Map<String, String> TABLES = SyncJournal.WIRE_NAMES.entrySet().stream()
        .collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getValue, Map.Entry::getKey));
    private static final int MAX_MEMBERS = 100;

    private final RowStore store;
    private final EntityRepository repository;
    private final SyncJournal journal;
    private final TaskService tasks;
    private final ObjectMapper json;

    public SyncService(RowStore store, EntityRepository repository, SyncJournal journal, TaskService tasks, ObjectMapper json) {
        this.store = store;
        this.repository = repository;
        this.journal = journal;
        this.tasks = tasks;
        this.json = json;
    }

    // ── Which workspaces this device holds ─────────────────────────────────────────────────────────────────────────────

    /** Records (or refreshes) a shared workspace this signed-in account belongs to. */
    @Transactional
    public Map<String, Object> register(String personal, Map<String, Object> body) {
        String workspaceId = workspaceId(body.get("workspaceId"));
        if (workspaceId.equals(personal)) throw ApiException.invalid("A shared workspace cannot be your own workspace");
        Map<String, Object> existing = info(workspaceId);
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("WorkspaceId", workspaceId);
        row.put("Name", Values.required(body, "name", 120));
        row.put("Role", "owner".equals(body.get("role")) ? "owner" : "member");
        row.put("Members", write(members(body.get("members"))));
        row.put("State", "removed".equals(body.get("state")) ? "removed" : "active");
        if (existing == null) row.put("Cursor", 0L);
        Set<String> locals = new java.util.LinkedHashSet<>(localOwners(row));
        locals.add(personal);
        row.put("LocalOwners", write(new ArrayList<>(locals)));
        if (existing == null) repository.insert(StorageTables.WORKSPACE_INFO, workspaceId, row);
        else repository.replace(StorageTables.WORKSPACE_INFO, workspaceId, workspaceId, row);
        return view(row);
    }

    /** The shared workspaces this account can use on this device. */
    public List<Map<String, Object>> workspaces(String personal) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String owner : repository.owners(StorageTables.WORKSPACE_INFO)) {
            Map<String, Object> row = info(owner);
            if (row != null && localOwners(row).contains(personal)) out.add(view(row));
        }
        out.sort(java.util.Comparator.comparing(w -> String.valueOf(w.get("name")).toLowerCase()));
        return out;
    }

    /** Whether this account may read (or, with {@code write}, change) this workspace here. Removed members keep a read-only copy. */
    public boolean canUse(String personal, String workspaceId, boolean write) {
        if (workspaceId == null || !workspaceId.matches("[A-Za-z0-9_-]{43}")) return false;
        Map<String, Object> row = info(workspaceId);
        if (row == null || !localOwners(row).contains(personal)) return false;
        return !write || "active".equals(EntityRepository.text(row.get("State")));
    }

    // ── Sending this device's changes ──────────────────────────────────────────────────────────────────────────────────

    public Map<String, Object> outbox(String personal, String workspaceId, int limit) {
        require(personal, workspaceId);
        List<Map<String, Object>> ops = new ArrayList<>();
        for (Map<String, Object> row : journal.pending(workspaceId, Math.max(1, Math.min(200, limit)))) {
            ops.add(Map.of("opId", EntityRepository.text(row.get("OpId")), "op", journal.parse(row.get("Op"))));
        }
        return Map.of("workspaceId", workspaceId, "ops", ops);
    }

    @Transactional
    public Map<String, Object> acknowledge(String personal, String workspaceId, Object opIds) {
        require(personal, workspaceId);
        Set<String> ids = new HashSet<>();
        if (opIds instanceof List<?> list) list.forEach(id -> ids.add(String.valueOf(id)));
        return Map.of("removed", journal.acknowledge(workspaceId, ids));
    }

    // ── Applying other members' changes ────────────────────────────────────────────────────────────────────────────────

    /**
     * Applies changes pulled from the cloud, in order. A change already applied is skipped; a gap stops the run (the
     * engine pulls again from the returned cursor). Returns the new cursor.
     */
    @Transactional
    public Map<String, Object> apply(String personal, String workspaceId, Object changes) {
        require(personal, workspaceId);
        if (!(changes instanceof List<?> list)) throw ApiException.invalid("changes must be a list");
        Map<String, Object> row = new LinkedHashMap<>(info(workspaceId));
        long cursor = Values.number(row.get("Cursor"), 0);
        int applied = 0;
        boolean gap = false;
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> change)) throw ApiException.invalid("each change must be an object");
            long seq = Values.number(change.get("seq"), -1);
            if (seq <= cursor) continue;
            if (seq != cursor + 1) { gap = true; break; }
            Object ops = change.get("ops");
            if (!(ops instanceof List<?> opList)) throw ApiException.invalid("ops must be a list");
            journal.applyingRemote(() -> { opList.forEach(op -> applyOp(workspaceId, op)); return null; });
            cursor = seq;
            applied++;
        }
        row.put("Cursor", cursor);
        repository.replace(StorageTables.WORKSPACE_INFO, workspaceId, workspaceId, row);
        return Map.of("cursor", cursor, "applied", applied, "gap", gap);
    }

    private void applyOp(String workspaceId, Object raw) {
        if (!(raw instanceof Map<?, ?> op)) throw ApiException.invalid("each op must be an object");
        String wire = String.valueOf(op.get("table"));
        if ("fragments".equals(wire)) {
            applyFragment(workspaceId, op);
            return;
        }
        String table = TABLES.get(wire);
        String id = String.valueOf(op.get("id"));
        if (table == null || !Values.SAFE_ID.matcher(id).matches()) throw ApiException.invalid("unknown op");
        Set<String> pending = journal.pendingFields(workspaceId, wire, id);
        var existing = repository.find(table, workspaceId, id);
        if (Boolean.TRUE.equals(op.get("deleted"))) {
            if (existing.isPresent()) {
                if (StorageTables.TASKS.equals(table)) {
                    repository.deleteRows(StorageTables.FIELD_VALUES, workspaceId, r -> id.equals(EntityRepository.text(r.get("TaskId"))));
                }
                repository.delete(table, workspaceId, id);
            }
            repository.deleteRows(StorageTables.SYNC_FRAGMENTS, workspaceId,
                part -> wire.equals(part.get("Table")) && id.equals(part.get("EntityId")));
            return;
        }
        if (pending.contains("*")) return; // deleted here, and that is about to be sent
        Map<String, Object> fields = new LinkedHashMap<>();
        if (op.get("fields") instanceof Map<?, ?> given) {
            Set<String> allowed = SyncJournal.SHARED_FIELDS.get(table);
            given.forEach((k, v) -> {
                String key = String.valueOf(k);
                if ((allowed.contains(key) || (StorageTables.TASKS.equals(table) && sourceFieldAllowed(workspaceId, key, given)))
                    && !pending.contains(key)) fields.put(key, v);
            });
        }
        if (existing.isPresent()) {
            if (fields.isEmpty()) return;
            Map<String, Object> merged = new LinkedHashMap<>(existing.get());
            merged.putAll(fields);
            repository.replace(table, workspaceId, id, merged);
        } else {
            Map<String, Object> created = new LinkedHashMap<>(fields);
            created.put(StorageTables.primaryKey(table), id);
            repository.insert(table, workspaceId, created);
        }
    }

    private boolean sourceFieldAllowed(String owner, String key, Map<?, ?> fields) {
        if (List.of("SourceNoteId", "SourceBlockId").contains(key)) {
            String id = EntityRepository.text(fields.get("SourceNoteId"));
            return id.isBlank() || repository.find(StorageTables.NOTES, owner, id).isPresent();
        }
        if (List.of("SourceRecordId", "SourceFieldId").contains(key)) {
            String id = EntityRepository.text(fields.get("SourceRecordId"));
            return id.isBlank() || repository.find(StorageTables.DATABASE_ROWS, owner, id).isPresent();
        }
        return false;
    }

    private void applyFragment(String owner, Map<?, ?> op) {
        if (!(op.get("fields") instanceof Map<?, ?> fields)) throw ApiException.invalid("invalid content fragment");
        String wire = EntityRepository.text(fields.get("Table"));
        String table = TABLES.get(wire);
        String id = EntityRepository.text(fields.get("EntityId"));
        String field = EntityRepository.text(fields.get("Field"));
        String version = EntityRepository.text(fields.get("Version"));
        int index = (int) Values.number(fields.get("Part"), -1);
        int count = (int) Values.number(fields.get("Parts"), -1);
        String value = EntityRepository.text(fields.get("Value"));
        if (table == null || !SyncJournal.SHARED_FIELDS.get(table).contains(field)
            || !Values.SAFE_ID.matcher(id).matches() || !Values.SAFE_ID.matcher(version).matches()
            || count < 1 || count > 64 || index < 0 || index >= count || value.length() > 4000) {
            throw ApiException.invalid("invalid content fragment");
        }
        String fragmentId = version + "-" + index;
        Map<String, Object> part = new LinkedHashMap<>();
        fields.forEach((key, item) -> part.put(String.valueOf(key), item));
        part.put("FragmentId", fragmentId);
        if (repository.find(StorageTables.SYNC_FRAGMENTS, owner, fragmentId).isPresent()) {
            repository.replace(StorageTables.SYNC_FRAGMENTS, owner, fragmentId, part);
        } else repository.insert(StorageTables.SYNC_FRAGMENTS, owner, part);
        List<Map<String, Object>> parts = repository.list(StorageTables.SYNC_FRAGMENTS, owner).stream()
            .filter(row -> version.equals(row.get("Version")) && wire.equals(row.get("Table")) && id.equals(row.get("EntityId")) && field.equals(row.get("Field")))
            .sorted(java.util.Comparator.comparingLong(row -> Values.number(row.get("Part"), -1))).toList();
        if (parts.size() != count) return;
        StringBuilder content = new StringBuilder();
        for (int position = 0; position < count; position++) {
            Map<String, Object> row = parts.get(position);
            if (Values.number(row.get("Part"), -1) != position || Values.number(row.get("Parts"), -1) != count) {
                throw ApiException.invalid("inconsistent content fragments");
            }
            content.append(EntityRepository.text(row.get("Value")));
        }
        applyOp(owner, Map.of("table", wire, "id", id, "fields", Map.of(field, content.toString())));
        repository.deleteRows(StorageTables.SYNC_FRAGMENTS, owner, row -> version.equals(row.get("Version")));
    }

    @Transactional
    public Map<String, Object> shareSource(String personal, String workspaceId, String kind, String id) {
        require(personal, workspaceId);
        if (!canUse(personal, workspaceId, true)) throw ApiException.forbidden();
        Values.id(id);
        String table = switch (kind) {
            case "note" -> StorageTables.NOTES;
            case "database" -> StorageTables.DATABASES;
            default -> throw ApiException.invalid("unknown source kind");
        };
        Map<String, Object> source = repository.require(table, personal, id);
        String key = UUID.nameUUIDFromBytes((workspaceId + ":" + kind + ":" + id).getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        var existing = repository.find(StorageTables.SHARED_SOURCES, personal, key);
        if (existing.isPresent()) return journal.parse(existing.get().get("Result"));
        Map<String, String> recordIds = new LinkedHashMap<>();
        Map<String, String> fieldIds = new LinkedHashMap<>();
        String sharedId = UUID.randomUUID().toString();
        if ("database".equals(kind)) {
            List<Map<String, Object>> fields = repository.list(StorageTables.FIELD_DEFS, personal).stream()
                .filter(row -> id.equals(row.get("DatabaseId"))).toList();
            List<Map<String, Object>> records = repository.list(StorageTables.DATABASE_ROWS, personal).stream()
                .filter(row -> id.equals(row.get("DatabaseId"))).toList();
            fields.forEach(row -> fieldIds.put(EntityRepository.text(row.get("DefId")), UUID.randomUUID().toString()));
            records.forEach(row -> recordIds.put(EntityRepository.text(row.get("RecordId")), UUID.randomUUID().toString()));
            Map<String, Object> copy = only(source, table);
            copy.put("DatabaseId", sharedId);
            copy.put("DateFieldId", fieldIds.getOrDefault(EntityRepository.text(source.get("DateFieldId")), ""));
            repository.insert(table, workspaceId, copy);
            for (Map<String, Object> field : fields) {
                Map<String, Object> copied = only(field, StorageTables.FIELD_DEFS);
                copied.put("DefId", fieldIds.get(EntityRepository.text(field.get("DefId"))));
                copied.put("DatabaseId", sharedId);
                repository.insert(StorageTables.FIELD_DEFS, workspaceId, copied);
            }
            for (Map<String, Object> record : records) {
                Map<String, Object> copied = only(record, StorageTables.DATABASE_ROWS);
                copied.put("RecordId", recordIds.get(EntityRepository.text(record.get("RecordId"))));
                copied.put("DatabaseId", sharedId);
                repository.insert(StorageTables.DATABASE_ROWS, workspaceId, copied);
            }
            for (Map<String, Object> value : repository.list(StorageTables.FIELD_VALUES, personal)) {
                String record = recordIds.get(EntityRepository.text(value.get("TaskId")));
                String field = fieldIds.get(EntityRepository.text(value.get("DefId")));
                if (record == null || field == null) continue;
                Map<String, Object> copied = only(value, StorageTables.FIELD_VALUES);
                copied.put("PropId", UUID.randomUUID().toString());
                copied.put("TaskId", record);
                copied.put("DefId", field);
                repository.insert(StorageTables.FIELD_VALUES, workspaceId, copied);
            }
        } else {
            Map<String, Object> copy = only(source, table);
            try {
                List<Map<String, Object>> blocks = json.readValue(EntityRepository.text(copy.get("BlocksJson")),
                    new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() { });
                for (Map<String, Object> block : blocks) {
                    block.remove("taskId");
                    if ("database".equals(block.get("type"))) {
                        throw ApiException.invalid("Share embedded databases separately before sharing this note");
                    }
                }
                copy.put("BlocksJson", write(blocks));
            } catch (JsonProcessingException error) { throw ApiException.invalid("source note content is invalid"); }
            copy.put("NoteId", sharedId);
            repository.insert(table, workspaceId, copy);
        }
        Map<String, Object> result = Map.of("kind", kind, "id", sharedId, "recordIds", recordIds, "fieldIds", fieldIds);
        repository.insert(StorageTables.SHARED_SOURCES, personal, Map.of("SourceKey", key, "Result", write(result)));
        return result;
    }

    public List<Map<String, Object>> sourceLists(String personal, String workspaceId) {
        require(personal, workspaceId);
        return new ListService(repository).list(workspaceId);
    }

    @Transactional
    public Map<String, Object> sourceTask(String personal, String actor, Map<String, Object> body) {
        String workspaceId = workspaceId(body.get("workspaceId"));
        require(personal, workspaceId);
        if (!canUse(personal, workspaceId, true)) throw ApiException.forbidden();
        String assignee = Values.required(body, "assigneeUserId", 30);
        Map<String, Object> member = members(read(info(workspaceId).get("Members"))).stream()
            .filter(candidate -> assignee.equals(candidate.get("userId"))).findFirst().orElseThrow(ApiException::forbidden);
        String clientId = Values.required(body, "clientId", 64);
        Values.id(clientId);
        String receiptId = UUID.nameUUIDFromBytes((workspaceId + ":task:" + clientId).getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        var receipt = repository.find(StorageTables.SHARED_SOURCES, personal, receiptId);
        if (receipt.isPresent()) return journal.parse(receipt.get().get("Result"));
        String noteId = EntityRepository.text(body.get("sourceNoteId"));
        String recordId = EntityRepository.text(body.get("sourceRecordId"));
        if (noteId.isBlank() == recordId.isBlank()) throw ApiException.invalid("one source is required");
        String kind = noteId.isBlank() ? "database" : "note";
        String sourceId = noteId;
        if (noteId.isBlank()) sourceId = EntityRepository.text(repository.require(StorageTables.DATABASE_ROWS, personal, recordId).get("DatabaseId"));
        Map<String, Object> source = shareSource(personal, workspaceId, kind, sourceId);
        Map<String, Object> taskBody = new LinkedHashMap<>(body);
        taskBody.put("assignedBy", actor);
        taskBody.put("assigneeName", member.get("name"));
        if (!noteId.isBlank()) {
            taskBody.put("sourceNoteId", source.get("id"));
        } else {
            taskBody.put("sourceRecordId", ((Map<?, ?>) source.get("recordIds")).get(recordId));
            String oldField = EntityRepository.text(body.get("sourceFieldId"));
            if (!oldField.isBlank()) {
                Object field = ((Map<?, ?>) source.get("fieldIds")).get(oldField);
                if (field == null) throw ApiException.invalid("source field is not in the database");
                taskBody.put("sourceFieldId", field);
            }
        }
        Map<String, Object> task = tasks.create(workspaceId, taskBody);
        if (!noteId.isBlank()) {
            String sharedId = String.valueOf(source.get("id"));
            Map<String, Object> note = new LinkedHashMap<>(repository.require(StorageTables.NOTES, workspaceId, sharedId));
            try {
                List<Map<String, Object>> blocks = json.readValue(EntityRepository.text(note.get("BlocksJson")),
                    new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() { });
                String blockId = EntityRepository.text(body.get("sourceBlockId"));
                Map<String, Object> block = blocks.stream().filter(item -> blockId.equals(item.get("id"))).findFirst().orElseThrow(ApiException::notFound);
                block.put("taskId", task.get("id"));
                note.put("BlocksJson", write(blocks));
                note.put("UpdatedAt", System.currentTimeMillis());
                repository.replace(StorageTables.NOTES, workspaceId, sharedId, note);
            } catch (JsonProcessingException error) { throw ApiException.invalid("source note content is invalid"); }
        }
        Map<String, Object> result = Map.of("task", task, "source", source);
        repository.insert(StorageTables.SHARED_SOURCES, personal, Map.of("SourceKey", receiptId, "Result", write(result)));
        return result;
    }

    // ── Starting a shared workspace from personal lists ────────────────────────────────────────────────────────────────

    /**
     * Copies some of this account's own lists, with their tasks, into a shared workspace as new rows. The originals are not
     * touched, so stopping sharing never loses anything. The copies are journaled and go out to the members like any change.
     */
    @Transactional
    public Map<String, Object> seed(String personal, String workspaceId, Object listIds) {
        require(personal, workspaceId);
        if (!canUse(personal, workspaceId, true)) throw ApiException.forbidden();
        Set<String> wanted = new HashSet<>();
        if (listIds instanceof List<?> ids) ids.forEach(id -> wanted.add(String.valueOf(id)));
        Map<String, String> newIds = new HashMap<>();
        int lists = 0;
        int copied = 0;
        for (Map<String, Object> list : repository.list(StorageTables.LISTS, personal)) {
            String oldId = EntityRepository.text(list.get("ListId"));
            if (!wanted.contains(oldId)) continue;
            String newId = UUID.randomUUID().toString();
            newIds.put(oldId, newId);
            Map<String, Object> copy = only(list, StorageTables.LISTS);
            copy.put("ListId", newId);
            repository.insert(StorageTables.LISTS, workspaceId, copy);
            lists++;
        }
        for (Map<String, Object> task : repository.list(StorageTables.TASKS, personal)) {
            String listId = newIds.get(EntityRepository.text(task.get("ListId")));
            if (listId == null) continue;
            Map<String, Object> copy = only(task, StorageTables.TASKS);
            copy.put("TaskId", UUID.randomUUID().toString());
            copy.put("ListId", listId);
            repository.insert(StorageTables.TASKS, workspaceId, copy);
            copied++;
        }
        return Map.of("lists", lists, "tasks", copied);
    }

    // ── Assigned to me ─────────────────────────────────────────────────────────────────────────────────────────────────

    /** Tasks assigned to this user in any shared workspace on this device, each labelled with its workspace. */
    public List<Map<String, Object>> assignedToMe(String personal, String userId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> workspace : workspaces(personal)) {
            String id = String.valueOf(workspace.get("workspaceId"));
            for (Map<String, Object> task : tasks.assignedTo(id, userId)) {
                Map<String, Object> labelled = new LinkedHashMap<>(task);
                labelled.put("workspaceId", id);
                labelled.put("workspaceName", workspace.get("name"));
                out.add(labelled);
            }
        }
        return out;
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────

    private void require(String personal, String workspaceId) {
        if (!canUse(personal, workspaceId, false)) throw ApiException.forbidden();
    }

    private Map<String, Object> info(String workspaceId) {
        return repository.find(StorageTables.WORKSPACE_INFO, workspaceId, workspaceId).orElse(null);
    }

    private static Map<String, Object> only(Map<String, Object> row, String table) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String key : SyncJournal.SHARED_FIELDS.get(table)) {
            if (row.containsKey(key)) out.put(key, row.get(key));
        }
        return out;
    }

    private Map<String, Object> view(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("workspaceId", EntityRepository.text(row.get("WorkspaceId")));
        out.put("name", EntityRepository.text(row.get("Name")));
        out.put("role", EntityRepository.text(row.get("Role")));
        out.put("state", EntityRepository.text(row.get("State")));
        out.put("cursor", Values.number(row.get("Cursor"), 0));
        out.put("members", read(row.get("Members")));
        return out;
    }

    private List<String> localOwners(Map<String, Object> row) {
        List<String> out = new ArrayList<>();
        for (Object o : read(row.get("LocalOwners"))) out.add(String.valueOf(o));
        return out;
    }

    private static List<Map<String, Object>> members(Object raw) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!(raw instanceof List<?> list)) return out;
        for (Object item : list) {
            if (out.size() >= MAX_MEMBERS) break;
            if (!(item instanceof Map<?, ?> m)) continue;
            String userId = String.valueOf(m.get("userId"));
            if (!userId.matches("[0-9]{5,30}")) continue;
            Map<String, Object> member = new LinkedHashMap<>();
            member.put("userId", userId);
            member.put("email", clip(m.get("email"), 254));
            member.put("name", clip(m.get("name"), 80));
            member.put("role", "owner".equals(m.get("role")) ? "owner" : "member");
            out.add(member);
        }
        return out;
    }

    private static String clip(Object value, int max) {
        String text = value == null ? "" : String.valueOf(value).trim();
        return text.length() > max ? text.substring(0, max) : text;
    }

    private static String workspaceId(Object value) {
        String id = value == null ? "" : String.valueOf(value);
        if (!id.matches("[A-Za-z0-9_-]{43}")) throw ApiException.invalid("workspaceId is not valid");
        return id;
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<Object> read(Object value) {
        if (value == null) return List.of();
        try {
            return json.readValue(String.valueOf(value), new com.fasterxml.jackson.core.type.TypeReference<List<Object>>() { });
        } catch (JsonProcessingException e) {
            return List.of();
        }
    }
}
