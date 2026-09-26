package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RemoteExportImportService {
    static final String SCHEMA = "hitlist.remote-export.v1";
    private static final Set<String> ROOT_KEYS = Set.of("schema", "exportedAt", "collections", "unsupported");
    private static final Set<String> COLLECTION_KEYS = Set.of(
        "lists", "tasks", "notes", "views", "fields", "taskFieldValues", "databases", "databaseRows", "recordFieldValues"
    );
    private static final Set<String> UNSUPPORTED_KEYS = Set.of(
        "reminders", "automationRules", "automationRuns", "notifications", "notificationQueue", "calendarConnections"
    );
    private static final Set<String> FORBIDDEN_KEYS = Set.of(
        "OwnerId", "ownerId", "ROWID", "rowId", "SourceOwnerId", "sourceOwnerId", "SourceRowId", "sourceRowId"
    );
    private static final Set<String> LIST_KEYS = Set.of("id", "name", "color", "listOrder", "createdAt", "updatedAt");
    private static final Set<String> TASK_KEYS = Set.of(
        "id", "title", "status", "quadrant", "priority", "note", "dueDate", "dueTime", "category", "listId", "taskOrder",
        "reminderEnabled", "reminderMinutesBefore", "completedAt", "createdAt", "updatedAt", "sourceNoteId", "sourceBlockId"
    );
    private static final Set<String> NOTE_KEYS = Set.of("id", "title", "blocksJson", "emoji", "pinned", "createdAt", "updatedAt");
    private static final Set<String> VIEW_KEYS = Set.of(
        "id", "name", "layout", "scopeListId", "filters", "showDone", "display", "viewOrder", "createdAt", "updatedAt"
    );
    private static final Set<String> FIELD_KEYS = Set.of(
        "id", "databaseId", "name", "kind", "options", "fieldOrder", "showOnCard", "createdAt", "updatedAt"
    );
    private static final Set<String> TASK_VALUE_KEYS = Set.of("taskId", "fieldId", "value");
    private static final Set<String> DATABASE_KEYS = Set.of("id", "name", "icon", "dateFieldId", "dbOrder", "createdAt", "updatedAt");
    private static final Set<String> DATABASE_ROW_KEYS = Set.of("id", "databaseId", "title", "rowOrder", "createdAt", "updatedAt");
    private static final Set<String> RECORD_VALUE_KEYS = Set.of("recordId", "fieldId", "value");
    private static final Set<String> DISPLAY_KEYS = Set.of("hidden", "order", "widths");
    private static final Set<String> OPTION_KEYS = Set.of("id", "label", "color");
    private static final Set<String> TASK_STATUSES = Set.of("TODO", "IN_PROGRESS", "DONE");
    private static final Set<String> TASK_QUADRANTS = Set.of("DO", "SCHEDULE", "DELEGATE", "ELIMINATE");
    private static final Set<String> TASK_PRIORITIES = Set.of("LOW", "MEDIUM", "HIGH");
    private static final Set<String> VIEW_LAYOUTS = Set.of("list", "matrix", "table", "board", "calendar");
    private static final Set<String> FIELD_KINDS = Set.of("select", "multi", "number", "date", "checkbox", "text");
    private static final Set<String> OPTION_COLORS = Set.of("accent", "sage", "do", "schedule", "delegate", "eliminate");
    private static final int MAX_LISTS = 500;
    private static final int MAX_TASKS = 50_000;
    private static final int MAX_NOTES = 10_000;
    private static final int MAX_VIEWS = 30;
    private static final int MAX_FIELDS = 1_500;
    private static final int MAX_TASK_VALUES = 100_000;
    private static final int MAX_DATABASES = 50;
    private static final int MAX_DATABASE_ROWS = 100_000;
    private static final int MAX_RECORD_VALUES = 200_000;
    private final EntityRepository repository;
    private final ObjectMapper objectMapper;

    public RemoteExportImportService(EntityRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Map<String, Object> importRemoteExport(String owner, Map<String, Object> payload) {
        ensureOwnerCanImport(owner);
        PreparedImport prepared = prepare(payload);
        long importedAt = System.currentTimeMillis();
        persist(owner, prepared, importedAt);
        return Map.of(
            "ok", true,
            "schema", SCHEMA,
            "importedAt", Instant.ofEpochMilli(importedAt).toString(),
            "counts", prepared.counts
        );
    }

    private void ensureOwnerCanImport(String owner) {
        boolean alreadyImported = repository.list(StorageTables.MIGRATION_MARKERS, owner).stream()
            .anyMatch(row -> "remote-export".equals(EntityRepository.text(row.get("MarkerType"))));
        if (alreadyImported) {
            throw ApiException.conflict("Remote export has already been imported for this owner");
        }
        for (String table : List.of(
            StorageTables.TASKS,
            StorageTables.LISTS,
            StorageTables.NOTES,
            StorageTables.VIEWS,
            StorageTables.FIELD_DEFS,
            StorageTables.FIELD_VALUES,
            StorageTables.DATABASES,
            StorageTables.DATABASE_ROWS,
            StorageTables.RULES,
            StorageTables.RUNS,
            StorageTables.NOTIFICATIONS,
            StorageTables.QUEUE,
            StorageTables.CALENDAR_CONNECTIONS
        )) {
            if (!repository.list(table, owner).isEmpty()) {
                throw ApiException.conflict("Remote export import requires an empty owner workspace");
            }
        }
    }

    private PreparedImport prepare(Map<String, Object> payload) {
        rejectForbiddenKeys("$", payload);
        rejectUnknownKeys("$", payload, ROOT_KEYS);
        if (!SCHEMA.equals(payload.get("schema"))) {
            throw ApiException.invalid("schema must be " + SCHEMA);
        }
        if (payload.containsKey("exportedAt") && payload.get("exportedAt") != null) {
            timestamp(payload.get("exportedAt"), "exportedAt", true);
        }
        Map<String, Object> collections = map(payload.get("collections"), "collections");
        rejectUnknownKeys("collections", collections, COLLECTION_KEYS);
        validateUnsupported(payload.get("unsupported"));

        List<Map<String, Object>> listDocs = listOfMaps(collections, "lists", MAX_LISTS);
        List<Map<String, Object>> taskDocs = listOfMaps(collections, "tasks", MAX_TASKS);
        List<Map<String, Object>> noteDocs = listOfMaps(collections, "notes", MAX_NOTES);
        List<Map<String, Object>> viewDocs = listOfMaps(collections, "views", MAX_VIEWS);
        List<Map<String, Object>> fieldDocs = listOfMaps(collections, "fields", MAX_FIELDS);
        List<Map<String, Object>> taskValueDocs = listOfMaps(collections, "taskFieldValues", MAX_TASK_VALUES);
        List<Map<String, Object>> databaseDocs = listOfMaps(collections, "databases", MAX_DATABASES);
        List<Map<String, Object>> databaseRowDocs = listOfMaps(collections, "databaseRows", MAX_DATABASE_ROWS);
        List<Map<String, Object>> recordValueDocs = listOfMaps(collections, "recordFieldValues", MAX_RECORD_VALUES);

        if (listDocs.isEmpty()
            && taskDocs.isEmpty()
            && noteDocs.isEmpty()
            && viewDocs.isEmpty()
            && fieldDocs.isEmpty()
            && taskValueDocs.isEmpty()
            && databaseDocs.isEmpty()
            && databaseRowDocs.isEmpty()
            && recordValueDocs.isEmpty()) {
            throw ApiException.invalid("collections must contain at least one supported record");
        }

        long now = System.currentTimeMillis();

        List<Map<String, Object>> lists = new ArrayList<>();
        Set<String> listIds = new LinkedHashSet<>();
        for (int index = 0; index < listDocs.size(); index++) {
            Map<String, Object> item = listDocs.get(index);
            String path = "collections.lists[" + index + "]";
            rejectUnknownKeys(path, item, LIST_KEYS);
            String id = requiredId(item, "id", path);
            ensureUnique(listIds, id, path + ".id");
            long createdAt = timestamp(item.get("createdAt"), path + ".createdAt", false, now);
            long updatedAt = timestamp(item.get("updatedAt"), path + ".updatedAt", false, createdAt);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ListId", id);
            row.put("Name", requiredString(item, "name", 255, path));
            row.put("Color", optionalString(item, "color", 32, "emerald"));
            row.put("ListOrder", optionalLong(item, "listOrder", 0, Long.MIN_VALUE, path));
            row.put("CreatedAt", createdAt);
            row.put("UpdatedAt", Math.max(updatedAt, createdAt));
            lists.add(row);
        }

        List<Map<String, Object>> notes = new ArrayList<>();
        Set<String> noteIds = new LinkedHashSet<>();
        for (int index = 0; index < noteDocs.size(); index++) {
            Map<String, Object> item = noteDocs.get(index);
            String path = "collections.notes[" + index + "]";
            rejectUnknownKeys(path, item, NOTE_KEYS);
            String id = requiredId(item, "id", path);
            ensureUnique(noteIds, id, path + ".id");
            long createdAt = timestamp(item.get("createdAt"), path + ".createdAt", false, now);
            long updatedAt = timestamp(item.get("updatedAt"), path + ".updatedAt", false, createdAt);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("NoteId", id);
            row.put("Title", requiredString(item, "title", 255, path));
            row.put("BlocksJson", optionalString(item, "blocksJson", 10_000, ""));
            row.put("Emoji", optionalString(item, "emoji", 16, "📝"));
            row.put("Pinned", optionalBoolean(item, "pinned", false, path));
            row.put("CreatedAt", createdAt);
            row.put("UpdatedAt", Math.max(updatedAt, createdAt));
            notes.add(row);
        }

        List<Map<String, Object>> databases = new ArrayList<>();
        Set<String> databaseIds = new LinkedHashSet<>();
        Map<String, String> databaseDateFields = new LinkedHashMap<>();
        for (int index = 0; index < databaseDocs.size(); index++) {
            Map<String, Object> item = databaseDocs.get(index);
            String path = "collections.databases[" + index + "]";
            rejectUnknownKeys(path, item, DATABASE_KEYS);
            String id = requiredId(item, "id", path);
            ensureUnique(databaseIds, id, path + ".id");
            long createdAt = timestamp(item.get("createdAt"), path + ".createdAt", false, now);
            long updatedAt = timestamp(item.get("updatedAt"), path + ".updatedAt", false, createdAt);
            String dateFieldId = optionalId(item, "dateFieldId", "", path);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("DatabaseId", id);
            row.put("Name", requiredString(item, "name", 100, path));
            row.put("Icon", optionalString(item, "icon", 16, ""));
            row.put("DateFieldId", dateFieldId);
            row.put("DbOrder", optionalLong(item, "dbOrder", 0, 0, path));
            row.put("CreatedAt", createdAt);
            row.put("UpdatedAt", Math.max(updatedAt, createdAt));
            databases.add(row);
            databaseDateFields.put(id, dateFieldId);
        }

        List<Map<String, Object>> fields = new ArrayList<>();
        Set<String> fieldIds = new LinkedHashSet<>();
        Map<String, Map<String, Object>> fieldById = new LinkedHashMap<>();
        Map<String, Integer> fieldCountsByDatabase = new LinkedHashMap<>();
        for (int index = 0; index < fieldDocs.size(); index++) {
            Map<String, Object> item = fieldDocs.get(index);
            String path = "collections.fields[" + index + "]";
            rejectUnknownKeys(path, item, FIELD_KEYS);
            String id = requiredId(item, "id", path);
            ensureUnique(fieldIds, id, path + ".id");
            String databaseId = optionalId(item, "databaseId", "", path);
            if (!databaseId.isBlank() && !databaseIds.contains(databaseId)) {
                throw ApiException.invalid(path + ".databaseId must reference an imported database");
            }
            String kind = requiredLowerEnum(item, "kind", FIELD_KINDS, path);
            List<Object> options = options(item, kind, path);
            long createdAt = timestamp(item.get("createdAt"), path + ".createdAt", false, now);
            long updatedAt = timestamp(item.get("updatedAt"), path + ".updatedAt", false, createdAt);
            int scopeCount = fieldCountsByDatabase.merge(databaseId, 1, Integer::sum);
            if (scopeCount > 30) {
                throw ApiException.invalid(path + " exceeds the 30-field limit for " + (databaseId.isBlank() ? "tasks" : "database " + databaseId));
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("DefId", id);
            row.put("DatabaseId", databaseId);
            row.put("Name", requiredString(item, "name", 100, path));
            row.put("FieldKind", kind);
            row.put("OptionsJson", json(options, path + ".options"));
            row.put("ShowOnCard", optionalBoolean(item, "showOnCard", false, path));
            row.put("DefOrder", optionalLong(item, "fieldOrder", 0, 0, path));
            row.put("CreatedAt", createdAt);
            row.put("UpdatedAt", Math.max(updatedAt, createdAt));
            fields.add(row);
            fieldById.put(id, row);
        }
        for (Map.Entry<String, String> entry : databaseDateFields.entrySet()) {
            String dateFieldId = entry.getValue();
            if (dateFieldId.isBlank()) {
                continue;
            }
            Map<String, Object> field = fieldById.get(dateFieldId);
            if (field == null || !entry.getKey().equals(EntityRepository.text(field.get("DatabaseId")))) {
                throw ApiException.invalid("collections.databases dateFieldId must reference a field on the same imported database");
            }
            if (!"date".equals(EntityRepository.text(field.get("FieldKind")))) {
                throw ApiException.invalid("collections.databases dateFieldId must reference a date field");
            }
        }

        List<Map<String, Object>> databaseRows = new ArrayList<>();
        Set<String> recordIds = new LinkedHashSet<>();
        Map<String, Map<String, Object>> recordById = new LinkedHashMap<>();
        for (int index = 0; index < databaseRowDocs.size(); index++) {
            Map<String, Object> item = databaseRowDocs.get(index);
            String path = "collections.databaseRows[" + index + "]";
            rejectUnknownKeys(path, item, DATABASE_ROW_KEYS);
            String id = requiredId(item, "id", path);
            ensureUnique(recordIds, id, path + ".id");
            String databaseId = requiredId(item, "databaseId", path);
            if (!databaseIds.contains(databaseId)) {
                throw ApiException.invalid(path + ".databaseId must reference an imported database");
            }
            long createdAt = timestamp(item.get("createdAt"), path + ".createdAt", false, now);
            long updatedAt = timestamp(item.get("updatedAt"), path + ".updatedAt", false, createdAt);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("RecordId", id);
            row.put("DatabaseId", databaseId);
            row.put("Title", requiredString(item, "title", 255, path));
            row.put("RowOrder", optionalLong(item, "rowOrder", 0, 0, path));
            row.put("CreatedAt", createdAt);
            row.put("UpdatedAt", Math.max(updatedAt, createdAt));
            databaseRows.add(row);
            recordById.put(id, row);
        }

        List<Map<String, Object>> tasks = new ArrayList<>();
        Set<String> taskIds = new LinkedHashSet<>();
        Map<String, Map<String, Object>> taskById = new LinkedHashMap<>();
        for (int index = 0; index < taskDocs.size(); index++) {
            Map<String, Object> item = taskDocs.get(index);
            String path = "collections.tasks[" + index + "]";
            rejectUnknownKeys(path, item, TASK_KEYS);
            String id = requiredId(item, "id", path);
            ensureUnique(taskIds, id, path + ".id");
            String listId = optionalId(item, "listId", "", path);
            if (!listId.isBlank() && !listIds.contains(listId)) {
                throw ApiException.invalid(path + ".listId must reference an imported list");
            }
            String sourceNoteId = optionalId(item, "sourceNoteId", "", path);
            if (!sourceNoteId.isBlank() && !noteIds.contains(sourceNoteId)) {
                throw ApiException.invalid(path + ".sourceNoteId must reference an imported note");
            }
            String sourceBlockId = optionalId(item, "sourceBlockId", "", path);
            if (!sourceBlockId.isBlank() && sourceNoteId.isBlank()) {
                throw ApiException.invalid(path + ".sourceBlockId requires sourceNoteId");
            }
            boolean reminderEnabled = optionalBoolean(item, "reminderEnabled", false, path);
            long reminderMinutesBefore = optionalLong(item, "reminderMinutesBefore", 0, 0, path);
            if (reminderEnabled || reminderMinutesBefore > 0) {
                throw ApiException.invalid(path + " contains reminder data, which is not supported by this importer");
            }
            String status = upperEnum(item, "status", TASK_STATUSES, "TODO", path);
            long createdAt = timestamp(item.get("createdAt"), path + ".createdAt", false, now);
            long updatedAt = timestamp(item.get("updatedAt"), path + ".updatedAt", false, createdAt);
            long completedAt = timestamp(item.get("completedAt"), path + ".completedAt", false, 0);
            if ("DONE".equals(status) && completedAt == 0) {
                throw ApiException.invalid(path + ".completedAt is required for DONE tasks");
            }
            if (!"DONE".equals(status) && completedAt != 0) {
                throw ApiException.invalid(path + ".completedAt is only allowed for DONE tasks");
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("TaskId", id);
            row.put("Title", requiredString(item, "title", 255, path));
            row.put("Status", status);
            row.put("Quadrant", upperEnum(item, "quadrant", TASK_QUADRANTS, "SCHEDULE", path));
            row.put("TaskPriority", upperEnum(item, "priority", TASK_PRIORITIES, "", path));
            row.put("Note", optionalString(item, "note", 10_000, ""));
            row.put("DueDate", optionalDate(item, "dueDate", "", path));
            row.put("DueTime", optionalTime(item, "dueTime", "", path));
            row.put("Category", optionalString(item, "category", 100, ""));
            row.put("ListId", listId);
            row.put("TaskOrder", optionalLong(item, "taskOrder", 0, Long.MIN_VALUE, path));
            row.put("ReminderEnabled", false);
            row.put("ReminderMinutesBefore", 0L);
            row.put("CompletedAt", completedAt);
            row.put("CreatedAt", createdAt);
            row.put("UpdatedAt", Math.max(updatedAt, createdAt));
            row.put("SourceNoteId", sourceNoteId);
            row.put("SourceBlockId", sourceBlockId);
            tasks.add(row);
            taskById.put(id, row);
        }

        List<Map<String, Object>> views = new ArrayList<>();
        Set<String> viewIds = new LinkedHashSet<>();
        for (int index = 0; index < viewDocs.size(); index++) {
            Map<String, Object> item = viewDocs.get(index);
            String path = "collections.views[" + index + "]";
            rejectUnknownKeys(path, item, VIEW_KEYS);
            String id = requiredId(item, "id", path);
            ensureUnique(viewIds, id, path + ".id");
            String scopeListId = optionalId(item, "scopeListId", "", path);
            if (!scopeListId.isBlank() && !listIds.contains(scopeListId)) {
                throw ApiException.invalid(path + ".scopeListId must reference an imported list");
            }
            Map<String, Object> filters = objectField(item.get("filters"), path + ".filters", Map.of());
            Map<String, Object> display = display(item.get("display"), path + ".display");
            long createdAt = timestamp(item.get("createdAt"), path + ".createdAt", false, now);
            long updatedAt = timestamp(item.get("updatedAt"), path + ".updatedAt", false, createdAt);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ViewId", id);
            row.put("Name", requiredString(item, "name", 100, path));
            row.put("ViewLayout", requiredLowerEnum(item, "layout", VIEW_LAYOUTS, path));
            row.put("ScopeListId", scopeListId);
            row.put("FilterJson", json(filters, path + ".filters"));
            row.put("DisplayJson", json(display, path + ".display"));
            row.put("ShowDone", optionalBoolean(item, "showDone", false, path));
            row.put("ViewOrder", optionalLong(item, "viewOrder", 0, 0, path));
            row.put("CreatedAt", createdAt);
            row.put("UpdatedAt", Math.max(updatedAt, createdAt));
            views.add(row);
        }

        List<Map<String, Object>> taskValues = new ArrayList<>();
        Set<String> taskValueKeys = new LinkedHashSet<>();
        for (int index = 0; index < taskValueDocs.size(); index++) {
            Map<String, Object> item = taskValueDocs.get(index);
            String path = "collections.taskFieldValues[" + index + "]";
            rejectUnknownKeys(path, item, TASK_VALUE_KEYS);
            String taskId = requiredId(item, "taskId", path);
            if (!taskById.containsKey(taskId)) {
                throw ApiException.invalid(path + ".taskId must reference an imported task");
            }
            String fieldId = requiredId(item, "fieldId", path);
            Map<String, Object> field = fieldById.get(fieldId);
            if (field == null || !EntityRepository.text(field.get("DatabaseId")).isBlank()) {
                throw ApiException.invalid(path + ".fieldId must reference an imported task field");
            }
            ensureUnique(taskValueKeys, taskId + "\u0000" + fieldId, path);
            String encoded = encodeFieldValue(field, item.get("value"), path + ".value");
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("PropId", UUID.randomUUID().toString());
            row.put("TaskId", taskId);
            row.put("DefId", fieldId);
            row.put("ValueText", encoded);
            row.put("UpdatedAt", now);
            taskValues.add(row);
        }

        List<Map<String, Object>> recordValues = new ArrayList<>();
        Set<String> recordValueKeys = new LinkedHashSet<>();
        for (int index = 0; index < recordValueDocs.size(); index++) {
            Map<String, Object> item = recordValueDocs.get(index);
            String path = "collections.recordFieldValues[" + index + "]";
            rejectUnknownKeys(path, item, RECORD_VALUE_KEYS);
            String recordId = requiredId(item, "recordId", path);
            Map<String, Object> record = recordById.get(recordId);
            if (record == null) {
                throw ApiException.invalid(path + ".recordId must reference an imported database row");
            }
            String fieldId = requiredId(item, "fieldId", path);
            Map<String, Object> field = fieldById.get(fieldId);
            if (field == null) {
                throw ApiException.invalid(path + ".fieldId must reference an imported field");
            }
            if (!EntityRepository.text(record.get("DatabaseId")).equals(EntityRepository.text(field.get("DatabaseId")))) {
                throw ApiException.invalid(path + ".fieldId must belong to the same database as the record");
            }
            ensureUnique(recordValueKeys, recordId + "\u0000" + fieldId, path);
            String encoded = encodeFieldValue(field, item.get("value"), path + ".value");
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("PropId", UUID.randomUUID().toString());
            row.put("TaskId", recordId);
            row.put("DefId", fieldId);
            row.put("ValueText", encoded);
            row.put("UpdatedAt", now);
            recordValues.add(row);
        }

        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("lists", lists.size());
        counts.put("tasks", tasks.size());
        counts.put("notes", notes.size());
        counts.put("views", views.size());
        counts.put("fields", fields.size());
        counts.put("taskFieldValues", taskValues.size());
        counts.put("databases", databases.size());
        counts.put("databaseRows", databaseRows.size());
        counts.put("recordFieldValues", recordValues.size());

        return new PreparedImport(lists, tasks, notes, views, fields, taskValues, databases, databaseRows, recordValues, counts);
    }

    private void persist(String owner, PreparedImport prepared, long importedAt) {
        prepared.lists.stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("ListOrder"), 0)))
            .forEach(row -> repository.insert(StorageTables.LISTS, owner, row));
        prepared.notes.forEach(row -> repository.insert(StorageTables.NOTES, owner, row));
        prepared.views.stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("ViewOrder"), 0)))
            .forEach(row -> repository.insert(StorageTables.VIEWS, owner, row));
        prepared.databases.stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("DbOrder"), 0)))
            .forEach(row -> repository.insert(StorageTables.DATABASES, owner, row));
        prepared.fields.stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("DefOrder"), 0)))
            .forEach(row -> repository.insert(StorageTables.FIELD_DEFS, owner, row));
        prepared.databaseRows.stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("RowOrder"), 0)))
            .forEach(row -> repository.insert(StorageTables.DATABASE_ROWS, owner, row));
        prepared.tasks.stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("TaskOrder"), 0)))
            .forEach(row -> repository.insert(StorageTables.TASKS, owner, row));
        prepared.taskValues.forEach(row -> repository.insert(StorageTables.FIELD_VALUES, owner, row));
        prepared.recordValues.forEach(row -> repository.insert(StorageTables.FIELD_VALUES, owner, row));

        Map<String, Object> marker = new LinkedHashMap<>();
        marker.put("MarkerId", "remote-export");
        marker.put("MarkerType", "remote-export");
        marker.put("Schema", SCHEMA);
        marker.put("ImportedAt", importedAt);
        marker.put("CountsJson", json(prepared.counts, "counts"));
        repository.insert(StorageTables.MIGRATION_MARKERS, owner, marker);
    }

    private void validateUnsupported(Object value) {
        if (value == null) {
            return;
        }
        Map<String, Object> unsupported = map(value, "unsupported");
        rejectUnknownKeys("unsupported", unsupported, UNSUPPORTED_KEYS);
        for (String key : UNSUPPORTED_KEYS) {
            if (!unsupported.containsKey(key) || unsupported.get(key) == null) {
                continue;
            }
            Object item = unsupported.get(key);
            boolean empty = switch (item) {
                case List<?> list -> list.isEmpty();
                case Map<?, ?> map -> map.isEmpty();
                case String text -> text.isBlank();
                default -> false;
            };
            if (!empty) {
                throw ApiException.invalid("unsupported." + key + " is not supported by this importer");
            }
        }
    }

    private List<Object> options(Map<String, Object> field, String kind, String path) {
        Object raw = field.get("options");
        List<Object> options = raw == null ? List.of() : list(raw, path + ".options");
        if (!Set.of("select", "multi").contains(kind)) {
            if (!options.isEmpty()) {
                throw ApiException.invalid(path + ".options is only allowed for select and multi fields");
            }
            return List.of();
        }
        List<Object> normalized = new ArrayList<>();
        Set<String> optionIds = new LinkedHashSet<>();
        for (int index = 0; index < options.size(); index++) {
            Map<String, Object> option = map(options.get(index), path + ".options[" + index + "]");
            rejectUnknownKeys(path + ".options[" + index + "]", option, OPTION_KEYS);
            String id = requiredId(option, "id", path + ".options[" + index + "]");
            ensureUnique(optionIds, id, path + ".options[" + index + "].id");
            String color = optionalString(option, "color", 16, "accent");
            if (!OPTION_COLORS.contains(color)) {
                throw ApiException.invalid(path + ".options[" + index + "].color is invalid");
            }
            normalized.add(Map.of(
                "id", id,
                "label", requiredString(option, "label", 100, path + ".options[" + index + "]"),
                "color", color
            ));
        }
        return normalized;
    }

    private Map<String, Object> display(Object raw, String path) {
        Map<String, Object> display = objectField(raw, path, Map.of("hidden", List.of(), "order", List.of(), "widths", Map.of()));
        rejectUnknownKeys(path, display, DISPLAY_KEYS);
        List<Object> hidden = stringList(display.get("hidden"), path + ".hidden");
        List<Object> order = stringList(display.get("order"), path + ".order");
        Map<String, Object> widths = objectField(display.get("widths"), path + ".widths", Map.of());
        Map<String, Object> normalizedWidths = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : widths.entrySet()) {
            if (!(entry.getValue() instanceof Number number) || !Double.isFinite(number.doubleValue()) || number.doubleValue() < 0) {
                throw ApiException.invalid(path + ".widths values must be non-negative numbers");
            }
            normalizedWidths.put(entry.getKey(), number.doubleValue());
        }
        Map<String, Object> normalized = new LinkedHashMap<>();
        normalized.put("hidden", hidden);
        normalized.put("order", order);
        normalized.put("widths", normalizedWidths);
        return normalized;
    }

    private String encodeFieldValue(Map<String, Object> field, Object value, String path) {
        if (value == null) {
            throw ApiException.invalid(path + " must not be null; omit the entry to leave a value empty");
        }
        String kind = EntityRepository.text(field.get("FieldKind"));
        List<Object> options = Values.jsonList(objectMapper, field.get("OptionsJson"));
        return switch (kind) {
            case "text" -> value instanceof String text && text.length() <= 2000
                ? text
                : invalidValue(path, "must be a string of at most 2000 characters");
            case "number" -> value instanceof Number number && Double.isFinite(number.doubleValue())
                ? String.valueOf(number)
                : invalidValue(path, "must be a finite number");
            case "date" -> {
                if (!(value instanceof String text)) {
                    yield invalidValue(path, "must be a YYYY-MM-DD string");
                }
                try {
                    yield LocalDate.parse(text).toString();
                } catch (DateTimeParseException exception) {
                    yield invalidValue(path, "must be a YYYY-MM-DD string");
                }
            }
            case "checkbox" -> value instanceof Boolean flag && flag
                ? "true"
                : invalidValue(path, "must be true; false values are not stored and should be omitted");
            case "select" -> value instanceof String selected && optionIds(options).contains(selected)
                ? selected
                : invalidValue(path, "must reference a valid option id");
            case "multi" -> {
                if (!(value instanceof List<?> list)) {
                    yield invalidValue(path, "must be an array of option ids");
                }
                Set<String> seen = new LinkedHashSet<>();
                List<String> selected = new ArrayList<>();
                for (Object item : list) {
                    if (!(item instanceof String optionId) || !optionIds(options).contains(optionId) || !seen.add(optionId)) {
                        yield invalidValue(path, "must be an array of unique valid option ids");
                    }
                    selected.add(optionId);
                }
                yield json(selected, path);
            }
            default -> throw ApiException.invalid(path + " uses unknown field kind " + kind);
        };
    }

    private Set<String> optionIds(List<Object> options) {
        Set<String> ids = new LinkedHashSet<>();
        for (Object option : options) {
            if (option instanceof Map<?, ?> map) {
                ids.add(String.valueOf(map.get("id")));
            }
        }
        return ids;
    }

    private String invalidValue(String path, String message) {
        throw ApiException.invalid(path + " " + message);
    }

    private void rejectForbiddenKeys(String path, Object value) {
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                if (FORBIDDEN_KEYS.contains(key)) {
                    throw ApiException.invalid(path + "." + key + " is not allowed; owner and row metadata come from the server");
                }
                rejectForbiddenKeys(path + "." + key, entry.getValue());
            }
        } else if (value instanceof List<?> list) {
            for (int index = 0; index < list.size(); index++) {
                rejectForbiddenKeys(path + "[" + index + "]", list.get(index));
            }
        }
    }

    private void rejectUnknownKeys(String path, Map<String, Object> value, Set<String> allowed) {
        for (String key : value.keySet()) {
            if (!allowed.contains(key)) {
                throw ApiException.invalid(path + " contains unsupported key " + key);
            }
        }
    }

    private List<Map<String, Object>> listOfMaps(Map<String, Object> parent, String key, int max) {
        if (!parent.containsKey(key) || parent.get(key) == null) {
            return List.of();
        }
        List<Object> raw = list(parent.get(key), "collections." + key);
        if (raw.size() > max) {
            throw ApiException.invalid("collections." + key + " exceeds the limit of " + max + " records");
        }
        List<Map<String, Object>> output = new ArrayList<>();
        for (int index = 0; index < raw.size(); index++) {
            output.add(map(raw.get(index), "collections." + key + "[" + index + "]"));
        }
        return output;
    }

    private List<Object> list(Object value, String path) {
        if (!(value instanceof List<?> list)) {
            throw ApiException.invalid(path + " must be an array");
        }
        return new ArrayList<>(list);
    }

    private Map<String, Object> map(Object value, String path) {
        if (!(value instanceof Map<?, ?> raw)) {
            throw ApiException.invalid(path + " must be an object");
        }
        Map<String, Object> output = new LinkedHashMap<>();
        raw.forEach((key, item) -> output.put(String.valueOf(key), item));
        return output;
    }

    private Map<String, Object> objectField(Object value, String path, Map<String, Object> fallback) {
        if (value == null) {
            return new LinkedHashMap<>(fallback);
        }
        return map(value, path);
    }

    private List<Object> stringList(Object value, String path) {
        List<Object> list = value == null ? List.of() : list(value, path);
        for (Object item : list) {
            if (!(item instanceof String text) || text.isBlank() || text.length() > 64) {
                throw ApiException.invalid(path + " must contain non-empty strings of at most 64 characters");
            }
        }
        return list;
    }

    private String requiredId(Map<String, Object> value, String field, String path) {
        Object raw = value.get(field);
        if (!(raw instanceof String id) || id.isBlank()) {
            throw ApiException.invalid(path + "." + field + " must be a non-empty string");
        }
        Values.id(id);
        return id;
    }

    private String optionalId(Map<String, Object> value, String field, String fallback, String path) {
        String id = optionalString(value, field, 64, fallback);
        if (!id.isBlank()) {
            Values.id(id);
        }
        return id;
    }

    private String requiredString(Map<String, Object> value, String field, int max, String path) {
        Object raw = value.get(field);
        if (!(raw instanceof String text) || text.trim().isEmpty() || text.trim().length() > max) {
            throw ApiException.invalid(path + "." + field + " must be a non-empty string of at most " + max + " characters");
        }
        return text.trim();
    }

    private String optionalString(Map<String, Object> value, String field, int max, String fallback) {
        if (!value.containsKey(field) || value.get(field) == null) {
            return fallback;
        }
        Object raw = value.get(field);
        if (!(raw instanceof String text) || text.length() > max) {
            throw ApiException.invalid(field + " must be a string of at most " + max + " characters");
        }
        return text;
    }

    private String optionalDate(Map<String, Object> value, String field, String fallback, String path) {
        String date = optionalString(value, field, 10, fallback);
        if (date.isBlank()) {
            return date;
        }
        try {
            return LocalDate.parse(date).toString();
        } catch (DateTimeParseException exception) {
            throw ApiException.invalid(path + "." + field + " must be a YYYY-MM-DD string");
        }
    }

    private String optionalTime(Map<String, Object> value, String field, String fallback, String path) {
        String time = optionalString(value, field, 8, fallback);
        if (time.isBlank()) {
            return time;
        }
        try {
            return LocalTime.parse(time).toString();
        } catch (DateTimeParseException exception) {
            throw ApiException.invalid(path + "." + field + " must be an HH:MM or HH:MM:SS string");
        }
    }

    private String requiredLowerEnum(Map<String, Object> value, String field, Set<String> allowed, String path) {
        Object raw = value.get(field);
        if (!(raw instanceof String text)) {
            throw ApiException.invalid(path + "." + field + " must be a string");
        }
        String normalized = text.toLowerCase(Locale.ROOT);
        if (!allowed.contains(normalized)) {
            throw ApiException.invalid(path + "." + field + " is invalid");
        }
        return normalized;
    }

    private String upperEnum(Map<String, Object> value, String field, Set<String> allowed, String fallback, String path) {
        if (!value.containsKey(field) || value.get(field) == null || "".equals(value.get(field))) {
            return fallback;
        }
        Object raw = value.get(field);
        if (!(raw instanceof String text)) {
            throw ApiException.invalid(path + "." + field + " must be a string");
        }
        String normalized = text.toUpperCase(Locale.ROOT);
        if (!allowed.contains(normalized)) {
            throw ApiException.invalid(path + "." + field + " must be one of " + String.join(", ", allowed));
        }
        return normalized;
    }

    private boolean optionalBoolean(Map<String, Object> value, String field, boolean fallback, String path) {
        if (!value.containsKey(field) || value.get(field) == null || "".equals(value.get(field))) {
            return fallback;
        }
        Object raw = value.get(field);
        if (raw instanceof Boolean flag) {
            return flag;
        }
        throw ApiException.invalid(path + "." + field + " must be a boolean");
    }

    private long optionalLong(Map<String, Object> value, String field, long fallback, long minimum, String path) {
        if (!value.containsKey(field) || value.get(field) == null || "".equals(value.get(field))) {
            return fallback;
        }
        Object raw = value.get(field);
        if (!(raw instanceof Number number) || !Double.isFinite(number.doubleValue()) || number.longValue() < minimum) {
            throw ApiException.invalid(path + "." + field + " must be a finite number no less than " + minimum);
        }
        return number.longValue();
    }

    private long timestamp(Object value, String field, boolean required) {
        return timestamp(value, field, required, 0);
    }

    private long timestamp(Object value, String field, boolean required, long fallback) {
        if (value == null || "".equals(value)) {
            if (required) {
                throw ApiException.invalid(field + " is required");
            }
            return fallback;
        }
        if (value instanceof Number number && Double.isFinite(number.doubleValue()) && number.longValue() >= 0) {
            return number.longValue();
        }
        if (value instanceof String text) {
            if (text.isBlank()) {
                return fallback;
            }
            try {
                return Instant.parse(text).toEpochMilli();
            } catch (DateTimeParseException ignored) {
                try {
                    long parsed = Long.parseLong(text);
                    if (parsed >= 0) {
                        return parsed;
                    }
                } catch (NumberFormatException ignoredToo) {
                    // fall through
                }
            }
        }
        throw ApiException.invalid(field + " must be an ISO-8601 instant or epoch-millisecond number");
    }

    private void ensureUnique(Set<String> seen, String value, String path) {
        if (!seen.add(value)) {
            throw ApiException.invalid(path + " is duplicated");
        }
    }

    private String json(Object value, String field) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw ApiException.invalid(field + " contains invalid JSON");
        }
    }

    private record PreparedImport(
        List<Map<String, Object>> lists,
        List<Map<String, Object>> tasks,
        List<Map<String, Object>> notes,
        List<Map<String, Object>> views,
        List<Map<String, Object>> fields,
        List<Map<String, Object>> taskValues,
        List<Map<String, Object>> databases,
        List<Map<String, Object>> databaseRows,
        List<Map<String, Object>> recordValues,
        Map<String, Object> counts
    ) {
    }
}
