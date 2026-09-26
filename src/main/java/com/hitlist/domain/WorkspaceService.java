package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class WorkspaceService {
    private final EntityRepository repository;
    private final ObjectMapper objectMapper;

    public WorkspaceService(EntityRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> views(String owner) {
        return repository.list(StorageTables.VIEWS, owner).stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("ViewOrder"), 0)))
            .map(this::viewApi)
            .toList();
    }

    public Map<String, Object> createView(String owner, Map<String, Object> body) {
        List<Map<String, Object>> existing = repository.list(StorageTables.VIEWS, owner);
        if (existing.size() >= 30) throw ApiException.invalid("you already have 30 saved views; delete one first");
        long now = System.currentTimeMillis();
        Map<String, Object> row = viewRow(body, null, now);
        row.put("ViewId", UUID.randomUUID().toString());
        row.put("ViewOrder", body.containsKey("viewOrder") ? Values.optionalLong(body, "viewOrder", 0, 0) : next(existing, "ViewOrder"));
        row.put("CreatedAt", now);
        row.put("UpdatedAt", now);
        repository.insert(StorageTables.VIEWS, owner, row);
        return viewApi(row);
    }

    public Map<String, Object> updateView(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> existing = repository.require(StorageTables.VIEWS, owner, id);
        Map<String, Object> row = viewRow(body, existing, System.currentTimeMillis());
        row.put("ViewId", id);
        row.put("CreatedAt", existing.get("CreatedAt"));
        row.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.VIEWS, owner, id, row);
        return viewApi(row);
    }

    public void deleteView(String owner, String id) {
        Values.id(id);
        repository.delete(StorageTables.VIEWS, owner, id);
    }

    public List<Map<String, Object>> fields(String owner, String databaseId) {
        return repository.list(StorageTables.FIELD_DEFS, owner).stream()
            .filter(row -> (databaseId == null ? "" : databaseId).equals(EntityRepository.text(row.get("DatabaseId"))))
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("DefOrder"), 0)))
            .map(this::fieldApi)
            .toList();
    }

    public Map<String, Object> createField(String owner, Map<String, Object> body) {
        String databaseId = Values.optional(body, "databaseId", 64, "");
        if (!databaseId.isBlank() && repository.find(StorageTables.DATABASES, owner, databaseId).isEmpty()) throw ApiException.notFound();
        List<Map<String, Object>> fields = fieldsRaw(owner, databaseId);
        if (fields.size() >= 30) throw ApiException.invalid("you already have 30 fields; delete one first");
        long now = System.currentTimeMillis();
        Map<String, Object> row = fieldRow(body, null);
        row.put("DefId", UUID.randomUUID().toString());
        row.put("DatabaseId", databaseId);
        row.put("DefOrder", body.containsKey("fieldOrder") ? Values.optionalLong(body, "fieldOrder", 0, 0) : next(fields, "DefOrder"));
        row.put("CreatedAt", now);
        row.put("UpdatedAt", now);
        repository.insert(StorageTables.FIELD_DEFS, owner, row);
        return fieldApi(row);
    }

    public Map<String, Object> updateField(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> existing = repository.require(StorageTables.FIELD_DEFS, owner, id);
        Map<String, Object> row = fieldRow(body, existing);
        row.put("DefId", id);
        row.put("DatabaseId", existing.getOrDefault("DatabaseId", ""));
        row.put("DefOrder", body.containsKey("fieldOrder") ? Values.optionalLong(body, "fieldOrder", Values.number(existing.get("DefOrder"), 0), 0) : existing.get("DefOrder"));
        row.put("CreatedAt", existing.get("CreatedAt"));
        row.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.FIELD_DEFS, owner, id, row);
        return fieldApi(row);
    }

    public void deleteField(String owner, String id) {
        Values.id(id);
        repository.require(StorageTables.FIELD_DEFS, owner, id);
        repository.deleteRows(StorageTables.FIELD_VALUES, owner, row -> id.equals(EntityRepository.text(row.get("DefId"))));
        repository.delete(StorageTables.FIELD_DEFS, owner, id);
    }

    public List<Map<String, Object>> taskValues(String owner) {
        return values(owner, "", false);
    }

    public List<Map<String, Object>> recordValues(String owner, String databaseId) {
        return values(owner, databaseId, true);
    }

    public Map<String, Object> setTaskValue(String owner, String taskId, String fieldId, Object value) {
        Values.id(taskId);
        Map<String, Object> task = repository.require(StorageTables.TASKS, owner, taskId);
        if (task.isEmpty()) throw ApiException.notFound();
        Map<String, Object> def = repository.require(StorageTables.FIELD_DEFS, owner, fieldId);
        if (!EntityRepository.text(def.get("DatabaseId")).isBlank()) throw ApiException.notFound();
        return setValue(owner, taskId, fieldId, def, value, "taskId");
    }

    public Map<String, Object> setRecordValue(String owner, String recordId, String fieldId, Object value) {
        Values.id(recordId);
        Map<String, Object> record = repository.require(StorageTables.DATABASE_ROWS, owner, recordId);
        Map<String, Object> def = repository.require(StorageTables.FIELD_DEFS, owner, fieldId);
        if (!EntityRepository.text(record.get("DatabaseId")).equals(EntityRepository.text(def.get("DatabaseId")))) throw ApiException.notFound();
        return setValue(owner, recordId, fieldId, def, value, "recordId");
    }

    public List<Map<String, Object>> databases(String owner) {
        return repository.list(StorageTables.DATABASES, owner).stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("DbOrder"), 0)))
            .map(this::databaseApi)
            .toList();
    }

    public Map<String, Object> createDatabase(String owner, Map<String, Object> body) {
        List<Map<String, Object>> existing = repository.list(StorageTables.DATABASES, owner);
        if (existing.size() >= 50) throw ApiException.invalid("you already have 50 databases; delete one first");
        long now = System.currentTimeMillis();
        Map<String, Object> row = databaseRow(body, null);
        row.put("DatabaseId", UUID.randomUUID().toString());
        row.put("DbOrder", body.containsKey("dbOrder") ? Values.optionalLong(body, "dbOrder", 0, 0) : next(existing, "DbOrder"));
        row.put("CreatedAt", now);
        row.put("UpdatedAt", now);
        repository.insert(StorageTables.DATABASES, owner, row);
        return databaseApi(row);
    }

    public Map<String, Object> updateDatabase(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> existing = repository.require(StorageTables.DATABASES, owner, id);
        Map<String, Object> row = databaseRow(body, existing);
        row.put("DatabaseId", id);
        row.put("DbOrder", body.containsKey("dbOrder") ? Values.optionalLong(body, "dbOrder", Values.number(existing.get("DbOrder"), 0), 0) : existing.get("DbOrder"));
        row.put("CreatedAt", existing.get("CreatedAt"));
        row.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.DATABASES, owner, id, row);
        return databaseApi(row);
    }

    public int deleteDatabase(String owner, String id) {
        Values.id(id);
        repository.require(StorageTables.DATABASES, owner, id);
        List<Map<String, Object>> records = databaseRowsRaw(owner, id);
        for (Map<String, Object> record : records) {
            String recordId = EntityRepository.text(record.get("RecordId"));
            repository.deleteRows(StorageTables.FIELD_VALUES, owner, row -> recordId.equals(EntityRepository.text(row.get("TaskId"))));
            repository.delete(StorageTables.DATABASE_ROWS, owner, recordId);
        }
        for (Map<String, Object> field : fieldsRaw(owner, id)) {
            String fieldId = EntityRepository.text(field.get("DefId"));
            repository.deleteRows(StorageTables.FIELD_VALUES, owner, row -> fieldId.equals(EntityRepository.text(row.get("DefId"))));
            repository.delete(StorageTables.FIELD_DEFS, owner, fieldId);
        }
        repository.delete(StorageTables.DATABASES, owner, id);
        return records.size();
    }

    public List<Map<String, Object>> databaseRows(String owner, String databaseId) {
        repository.require(StorageTables.DATABASES, owner, databaseId);
        return databaseRowsRaw(owner, databaseId).stream().map(this::recordApi).toList();
    }

    public Map<String, Object> createDatabaseRow(String owner, String databaseId, Map<String, Object> body) {
        repository.require(StorageTables.DATABASES, owner, databaseId);
        long now = System.currentTimeMillis();
        Map<String, Object> row = recordRow(body, null);
        row.put("RecordId", UUID.randomUUID().toString());
        row.put("DatabaseId", databaseId);
        row.put("RowOrder", body.containsKey("rowOrder") ? Values.optionalLong(body, "rowOrder", 0, 0) : next(databaseRowsRaw(owner, databaseId), "RowOrder"));
        row.put("CreatedAt", now);
        row.put("UpdatedAt", now);
        repository.insert(StorageTables.DATABASE_ROWS, owner, row);
        return recordApi(row);
    }

    public Map<String, Object> updateDatabaseRow(String owner, String recordId, Map<String, Object> body) {
        Values.id(recordId);
        Map<String, Object> existing = repository.require(StorageTables.DATABASE_ROWS, owner, recordId);
        Map<String, Object> row = recordRow(body, existing);
        row.put("RecordId", recordId);
        row.put("DatabaseId", existing.get("DatabaseId"));
        row.put("RowOrder", body.containsKey("rowOrder") ? Values.optionalLong(body, "rowOrder", Values.number(existing.get("RowOrder"), 0), 0) : existing.get("RowOrder"));
        row.put("CreatedAt", existing.get("CreatedAt"));
        row.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.DATABASE_ROWS, owner, recordId, row);
        return recordApi(row);
    }

    public void deleteDatabaseRow(String owner, String recordId) {
        Values.id(recordId);
        repository.require(StorageTables.DATABASE_ROWS, owner, recordId);
        repository.deleteRows(StorageTables.FIELD_VALUES, owner, row -> recordId.equals(EntityRepository.text(row.get("TaskId"))));
        repository.delete(StorageTables.DATABASE_ROWS, owner, recordId);
    }

    public List<Map<String, Object>> automationRules(String owner) {
        return repository.list(StorageTables.RULES, owner).stream().map(this::ruleApi).toList();
    }

    public Map<String, Object> createRule(String owner, Map<String, Object> body) {
        long now = System.currentTimeMillis();
        Map<String, Object> row = ruleRow(body, null);
        row.put("RuleId", UUID.randomUUID().toString());
        row.put("CreatedAt", now);
        row.put("UpdatedAt", now);
        repository.insert(StorageTables.RULES, owner, row);
        return ruleApi(row);
    }

    public Map<String, Object> updateRule(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> row = ruleRow(body, repository.require(StorageTables.RULES, owner, id));
        row.put("RuleId", id);
        row.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.RULES, owner, id, row);
        return ruleApi(row);
    }

    public void deleteRule(String owner, String id) {
        Values.id(id);
        repository.delete(StorageTables.RULES, owner, id);
    }

    public List<Map<String, Object>> runs(String owner, String ruleId, int limit) {
        return repository.list(StorageTables.RUNS, owner).stream()
            .filter(row -> ruleId == null || ruleId.equals(EntityRepository.text(row.get("RuleId"))))
            .sorted(Comparator.comparingLong((Map<String, Object> row) -> Values.number(row.get("TriggeredAt"), 0)).reversed())
            .limit(Math.max(1, Math.min(limit, 100)))
            .map(this::runApi)
            .toList();
    }

    public Map<String, Object> triggerRule(String owner, String ruleId) {
        Map<String, Object> rule = repository.require(StorageTables.RULES, owner, ruleId);
        long now = System.currentTimeMillis();
        Map<String, Object> run = new LinkedHashMap<>();
        run.put("RunId", UUID.randomUUID().toString());
        run.put("RuleId", ruleId);
        run.put("RuleName", EntityRepository.text(rule.get("Name")));
        run.put("TriggeredAt", now);
        run.put("RunStatus", "SUCCESS");
        run.put("TriggerSource", "manual");
        run.put("Detail", "queued by hand; delivery requires the notification delivery module");
        run.put("Channels", json(channels(rule)));
        repository.insert(StorageTables.RUNS, owner, run);
        return runApi(run);
    }

    public List<Map<String, Object>> notifications(String owner) {
        return repository.list(StorageTables.NOTIFICATIONS, owner).stream()
            .sorted(Comparator.comparingLong((Map<String, Object> row) -> Values.number(row.get("CreatedAt"), 0)).reversed())
            .map(this::notificationApi)
            .toList();
    }

    public void readNotification(String owner, String id) {
        Map<String, Object> row = repository.require(StorageTables.NOTIFICATIONS, owner, id);
        row.put("ReadAt", System.currentTimeMillis());
        repository.replace(StorageTables.NOTIFICATIONS, owner, id, row);
    }

    public int readAllNotifications(String owner) {
        int updated = 0;
        for (Map<String, Object> row : repository.list(StorageTables.NOTIFICATIONS, owner)) {
            if (Values.number(row.get("ReadAt"), 0) == 0) {
                row.put("ReadAt", System.currentTimeMillis());
                repository.replace(StorageTables.NOTIFICATIONS, owner, EntityRepository.text(row.get("NotificationId")), row);
                updated++;
            }
        }
        return updated;
    }

    public void deleteNotification(String owner, String id) {
        repository.delete(StorageTables.NOTIFICATIONS, owner, id);
    }

    public Map<String, Object> calendar(String owner) {
        List<Map<String, Object>> tasks = repository.list(StorageTables.TASKS, owner).stream()
            .filter(row -> !EntityRepository.text(row.get("DueDate")).isBlank())
            .map(row -> Map.<String, Object>of(
                "id", EntityRepository.text(row.get("TaskId")),
                "title", EntityRepository.text(row.get("Title")),
                "listId", EntityRepository.text(row.get("ListId")),
                "status", EntityRepository.text(row.get("Status")),
                "dueDate", EntityRepository.text(row.get("DueDate")),
                "dueTime", EntityRepository.text(row.get("DueTime")),
                "quadrant", EntityRepository.text(row.get("Quadrant"))
            ))
            .toList();
        List<Map<String, Object>> records = databases(owner).stream()
            .filter(database -> !EntityRepository.text(database.get("dateFieldId")).isBlank())
            .flatMap(database -> recordValues(owner, EntityRepository.text(database.get("id"))).stream()
                .filter(value -> EntityRepository.text(database.get("dateFieldId")).equals(EntityRepository.text(value.get("fieldId"))))
                .filter(value -> value.get("value") instanceof String date && date.matches("\\d{4}-\\d{2}-\\d{2}"))
                .map(value -> {
                    Map<String, Object> record = repository.require(StorageTables.DATABASE_ROWS, owner, EntityRepository.text(value.get("recordId")));
                    return Map.<String, Object>of(
                        "id", EntityRepository.text(record.get("RecordId")),
                        "databaseId", EntityRepository.text(database.get("id")),
                        "databaseName", EntityRepository.text(database.get("name")),
                        "title", EntityRepository.text(record.get("Title")),
                        "date", value.get("value")
                    );
                }))
            .toList();
        return Map.of("tasks", tasks, "records", records);
    }

    private List<Map<String, Object>> values(String owner, String databaseId, boolean recordValues) {
        Map<String, Map<String, Object>> fields = fieldsRaw(owner, databaseId).stream()
            .collect(java.util.stream.Collectors.toMap(row -> EntityRepository.text(row.get("DefId")), row -> row));
        return repository.list(StorageTables.FIELD_VALUES, owner).stream()
            .filter(row -> fields.containsKey(EntityRepository.text(row.get("DefId"))))
            .map(row -> {
                String idKey = recordValues ? "recordId" : "taskId";
                Map<String, Object> value = new LinkedHashMap<>();
                value.put(idKey, EntityRepository.text(row.get("TaskId")));
                value.put("fieldId", EntityRepository.text(row.get("DefId")));
                value.put("value", decode(fields.get(EntityRepository.text(row.get("DefId"))), EntityRepository.text(row.get("ValueText"))));
                return value;
            })
            .filter(row -> row.get("value") != null)
            .toList();
    }

    private Map<String, Object> setValue(String owner, String subjectId, String fieldId, Map<String, Object> field, Object rawValue, String idKey) {
        String text = encode(field, rawValue);
        Map<String, Object> existing = repository.list(StorageTables.FIELD_VALUES, owner).stream()
            .filter(row -> subjectId.equals(EntityRepository.text(row.get("TaskId"))) && fieldId.equals(EntityRepository.text(row.get("DefId"))))
            .findFirst()
            .orElse(null);
        if (text == null) {
            if (existing != null) repository.delete(StorageTables.FIELD_VALUES, owner, EntityRepository.text(existing.get("PropId")));
        } else if (existing == null) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("PropId", UUID.randomUUID().toString());
            row.put("TaskId", subjectId);
            row.put("DefId", fieldId);
            row.put("ValueText", text);
            row.put("UpdatedAt", System.currentTimeMillis());
            repository.insert(StorageTables.FIELD_VALUES, owner, row);
        } else {
            existing.put("ValueText", text);
            existing.put("UpdatedAt", System.currentTimeMillis());
            repository.replace(StorageTables.FIELD_VALUES, owner, EntityRepository.text(existing.get("PropId")), existing);
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put(idKey, subjectId);
        response.put("fieldId", fieldId);
        response.put("value", text == null ? null : decode(field, text));
        return response;
    }

    private Map<String, Object> viewRow(Map<String, Object> body, Map<String, Object> existing, long now) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("Name", body.containsKey("name") ? Values.required(body, "name", 100) : EntityRepository.text(row.get("Name")));
        row.put("ViewLayout", body.containsKey("layout") ? validLayout(Values.optional(body, "layout", 16, "list")) : EntityRepository.text(row.getOrDefault("ViewLayout", "list")));
        row.put("ScopeListId", body.containsKey("scopeListId") ? Values.optional(body, "scopeListId", 64, "") : EntityRepository.text(row.getOrDefault("ScopeListId", "")));
        row.put("FilterJson", body.containsKey("filters") ? json(body.get("filters")) : EntityRepository.text(row.getOrDefault("FilterJson", "{}")));
        row.put("DisplayJson", body.containsKey("display") ? json(body.get("display")) : EntityRepository.text(row.getOrDefault("DisplayJson", "{\"hidden\":[],\"order\":[],\"widths\":{}}")));
        row.put("ShowDone", body.containsKey("showDone") ? Values.optionalBoolean(body, "showDone", false) : Values.bool(row.get("ShowDone")));
        return row;
    }

    private Map<String, Object> fieldRow(Map<String, Object> body, Map<String, Object> existing) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        String kind = body.containsKey("kind") ? Values.optional(body, "kind", 16, "") : EntityRepository.text(row.get("FieldKind"));
        if (!List.of("select", "multi", "number", "date", "checkbox", "text").contains(kind)) throw ApiException.invalid("kind is invalid");
        if (existing != null && !kind.equals(EntityRepository.text(existing.get("FieldKind")))) throw ApiException.invalid("kind cannot change after the field is created");
        row.put("Name", body.containsKey("name") ? Values.required(body, "name", 100) : EntityRepository.text(row.get("Name")));
        row.put("FieldKind", kind);
        row.put("OptionsJson", body.containsKey("options") ? json(body.get("options")) : EntityRepository.text(row.getOrDefault("OptionsJson", "[]")));
        row.put("ShowOnCard", body.containsKey("showOnCard") ? Values.optionalBoolean(body, "showOnCard", false) : Values.bool(row.get("ShowOnCard")));
        return row;
    }

    private Map<String, Object> databaseRow(Map<String, Object> body, Map<String, Object> existing) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("Name", body.containsKey("name") ? Values.required(body, "name", 100) : EntityRepository.text(row.get("Name")));
        row.put("Icon", body.containsKey("icon") ? Values.optional(body, "icon", 16, "") : EntityRepository.text(row.getOrDefault("Icon", "")));
        String dateField = body.containsKey("dateFieldId") ? Values.optional(body, "dateFieldId", 64, "") : EntityRepository.text(row.getOrDefault("DateFieldId", ""));
        if (!dateField.isBlank()) Values.id(dateField);
        row.put("DateFieldId", dateField);
        return row;
    }

    private Map<String, Object> recordRow(Map<String, Object> body, Map<String, Object> existing) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("Title", body.containsKey("title") ? Values.required(body, "title", 255) : EntityRepository.text(row.get("Title")));
        return row;
    }

    private Map<String, Object> ruleRow(Map<String, Object> body, Map<String, Object> existing) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("Name", body.containsKey("name") ? Values.required(body, "name", 255) : EntityRepository.text(row.get("Name")));
        row.put("Description", body.containsKey("description") ? Values.optional(body, "description", 2000, "") : EntityRepository.text(row.getOrDefault("Description", "")));
        row.put("TaskId", body.containsKey("taskId") ? Values.optional(body, "taskId", 64, "") : EntityRepository.text(row.getOrDefault("TaskId", "")));
        row.put("TriggerType", body.containsKey("triggerType") ? lowerEnum(body, "triggerType", List.of("due-date", "overdue", "recurring", "status-change", "daily-digest"), "due-date") : EntityRepository.text(row.getOrDefault("TriggerType", "due-date")));
        row.put("RuleStatus", body.containsKey("status") ? lowerEnum(body, "status", List.of("active", "paused", "draft"), "draft") : EntityRepository.text(row.getOrDefault("RuleStatus", "draft")));
        row.put("Urgency", body.containsKey("urgency") ? lowerEnum(body, "urgency", List.of("low", "medium", "high", "critical"), "medium") : EntityRepository.text(row.getOrDefault("Urgency", "medium")));
        row.put("OffsetSteps", body.containsKey("offsetMinutes") ? json(body.get("offsetMinutes")) : EntityRepository.text(row.getOrDefault("OffsetSteps", "[]")));
        Map<String, Object> recurrence = body.get("recurrence") instanceof Map<?, ?> map ? mapOf(map) : Map.of();
        row.put("RecurrenceFreq", recurrence.containsKey("frequency") ? EntityRepository.text(recurrence.get("frequency")) : EntityRepository.text(row.getOrDefault("RecurrenceFreq", "daily")));
        row.put("RecurrenceTime", recurrence.containsKey("time") ? EntityRepository.text(recurrence.get("time")) : EntityRepository.text(row.getOrDefault("RecurrenceTime", "")));
        row.put("RecurrenceDayOfWeek", recurrence.getOrDefault("dayOfWeek", row.getOrDefault("RecurrenceDayOfWeek", 0)));
        row.put("RecurrenceDayOfMonth", recurrence.getOrDefault("dayOfMonth", row.getOrDefault("RecurrenceDayOfMonth", 1)));
        row.put("NotifyInApp", body.containsKey("notifyInApp") ? Values.optionalBoolean(body, "notifyInApp", true) : Values.bool(row.getOrDefault("NotifyInApp", true)));
        row.put("NotifyBrowser", body.containsKey("notifyBrowser") ? Values.optionalBoolean(body, "notifyBrowser", false) : Values.bool(row.get("NotifyBrowser")));
        row.put("NotifyEmail", body.containsKey("notifyEmail") ? Values.optionalBoolean(body, "notifyEmail", false) : Values.bool(row.get("NotifyEmail")));
        return row;
    }

    private Map<String, Object> viewApi(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("id", EntityRepository.text(row.get("ViewId")));
        output.put("name", EntityRepository.text(row.get("Name")));
        output.put("layout", EntityRepository.text(row.get("ViewLayout")));
        output.put("scopeListId", emptyToNull(EntityRepository.text(row.get("ScopeListId"))));
        output.put("filters", Values.jsonMap(objectMapper, row.get("FilterJson"), Map.of()));
        output.put("showDone", Values.bool(row.get("ShowDone")));
        output.put("display", Values.jsonMap(objectMapper, row.get("DisplayJson"), Map.of("hidden", List.of(), "order", List.of(), "widths", Map.of())));
        output.put("viewOrder", Values.number(row.get("ViewOrder"), 0));
        output.put("createdAt", Values.number(row.get("CreatedAt"), 0));
        output.put("updatedAt", Values.number(row.get("UpdatedAt"), 0));
        return output;
    }

    private Map<String, Object> fieldApi(Map<String, Object> row) {
        return Map.of(
            "id", EntityRepository.text(row.get("DefId")),
            "databaseId", EntityRepository.text(row.get("DatabaseId")),
            "name", EntityRepository.text(row.get("Name")),
            "kind", EntityRepository.text(row.get("FieldKind")),
            "options", Values.jsonList(objectMapper, row.get("OptionsJson")),
            "fieldOrder", Values.number(row.get("DefOrder"), 0),
            "showOnCard", Values.bool(row.get("ShowOnCard")),
            "createdAt", Values.number(row.get("CreatedAt"), 0),
            "updatedAt", Values.number(row.get("UpdatedAt"), 0)
        );
    }

    private Map<String, Object> databaseApi(Map<String, Object> row) {
        return Map.of(
            "id", EntityRepository.text(row.get("DatabaseId")),
            "name", EntityRepository.text(row.get("Name")),
            "icon", EntityRepository.text(row.get("Icon")),
            "dateFieldId", EntityRepository.text(row.get("DateFieldId")),
            "dbOrder", Values.number(row.get("DbOrder"), 0),
            "createdAt", Values.number(row.get("CreatedAt"), 0),
            "updatedAt", Values.number(row.get("UpdatedAt"), 0)
        );
    }

    private Map<String, Object> recordApi(Map<String, Object> row) {
        return Map.of(
            "id", EntityRepository.text(row.get("RecordId")),
            "databaseId", EntityRepository.text(row.get("DatabaseId")),
            "title", EntityRepository.text(row.get("Title")),
            "rowOrder", Values.number(row.get("RowOrder"), 0),
            "createdAt", Values.number(row.get("CreatedAt"), 0),
            "updatedAt", Values.number(row.get("UpdatedAt"), 0)
        );
    }

    private Map<String, Object> ruleApi(Map<String, Object> row) {
        Map<String, Object> recurrence = Map.of(
            "frequency", EntityRepository.text(row.get("RecurrenceFreq")),
            "time", EntityRepository.text(row.get("RecurrenceTime")),
            "dayOfWeek", Values.number(row.get("RecurrenceDayOfWeek"), 0),
            "dayOfMonth", Values.number(row.get("RecurrenceDayOfMonth"), 1)
        );
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("id", EntityRepository.text(row.get("RuleId")));
        output.put("name", EntityRepository.text(row.get("Name")));
        output.put("description", emptyToNull(EntityRepository.text(row.get("Description"))));
        output.put("taskId", emptyToNull(EntityRepository.text(row.get("TaskId"))));
        output.put("triggerType", EntityRepository.text(row.get("TriggerType")));
        output.put("status", EntityRepository.text(row.get("RuleStatus")));
        output.put("urgency", EntityRepository.text(row.get("Urgency")));
        output.put("offsetMinutes", Values.jsonList(objectMapper, row.get("OffsetSteps")));
        output.put("recurrence", recurrence);
        output.put("notifyInApp", Values.bool(row.get("NotifyInApp")));
        output.put("notifyBrowser", Values.bool(row.get("NotifyBrowser")));
        output.put("notifyEmail", Values.bool(row.get("NotifyEmail")));
        output.put("createdAt", Values.number(row.get("CreatedAt"), 0));
        output.put("updatedAt", Values.number(row.get("UpdatedAt"), 0));
        return output;
    }

    private Map<String, Object> runApi(Map<String, Object> row) {
        return Map.of(
            "id", EntityRepository.text(row.get("RunId")),
            "ruleId", EntityRepository.text(row.get("RuleId")),
            "ruleName", EntityRepository.text(row.get("RuleName")),
            "triggeredAt", Values.number(row.get("TriggeredAt"), 0),
            "status", EntityRepository.text(row.get("RunStatus")),
            "source", EntityRepository.text(row.get("TriggerSource")),
            "detail", EntityRepository.text(row.get("Detail")),
            "channels", Values.jsonList(objectMapper, row.get("Channels"))
        );
    }

    private Map<String, Object> notificationApi(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("id", EntityRepository.text(row.get("NotificationId")));
        output.put("title", EntityRepository.text(row.get("Title")));
        output.put("body", EntityRepository.text(row.get("Body")));
        output.put("kind", EntityRepository.text(row.get("Kind")));
        output.put("sourceType", EntityRepository.text(row.get("SourceType")));
        output.put("sourceId", EntityRepository.text(row.get("SourceId")));
        output.put("readAt", Values.number(row.get("ReadAt"), 0));
        output.put("createdAt", Values.number(row.get("CreatedAt"), 0));
        output.put("payload", Values.jsonMap(objectMapper, row.get("Payload"), Map.of()));
        return output;
    }

    private List<Map<String, Object>> fieldsRaw(String owner, String databaseId) {
        return repository.list(StorageTables.FIELD_DEFS, owner).stream()
            .filter(row -> databaseId.equals(EntityRepository.text(row.get("DatabaseId"))))
            .toList();
    }

    private List<Map<String, Object>> databaseRowsRaw(String owner, String databaseId) {
        return repository.list(StorageTables.DATABASE_ROWS, owner).stream()
            .filter(row -> databaseId.equals(EntityRepository.text(row.get("DatabaseId"))))
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("RowOrder"), 0)))
            .toList();
    }

    private String encode(Map<String, Object> field, Object value) {
        if (value == null || "".equals(value)) return null;
        String kind = EntityRepository.text(field.get("FieldKind"));
        List<Object> options = Values.jsonList(objectMapper, field.get("OptionsJson"));
        return switch (kind) {
            case "text" -> value instanceof String text && text.length() <= 2000 ? text : invalidValue();
            case "number" -> value instanceof Number number && Double.isFinite(number.doubleValue()) ? String.valueOf(number) : invalidValue();
            case "date" -> value instanceof String date && date.matches("\\d{4}-\\d{2}-\\d{2}") ? date : invalidValue();
            case "checkbox" -> value instanceof Boolean flag ? flag ? "true" : null : invalidValue();
            case "select" -> value instanceof String selected && optionIds(options).contains(selected) ? selected : invalidValue();
            case "multi" -> value instanceof List<?> selected && selected.stream().allMatch(item -> item instanceof String id && optionIds(options).contains(id))
                ? json(selected) : invalidValue();
            default -> throw ApiException.invalid("Unknown field kind");
        };
    }

    private Object decode(Map<String, Object> field, String text) {
        if (text.isBlank()) return null;
        return switch (EntityRepository.text(field.get("FieldKind"))) {
            case "number" -> {
                try {
                    yield Double.parseDouble(text);
                } catch (NumberFormatException exception) {
                    yield null;
                }
            }
            case "checkbox" -> "true".equals(text);
            case "multi" -> Values.jsonList(objectMapper, text);
            default -> text;
        };
    }

    private java.util.Set<String> optionIds(List<Object> options) {
        return options.stream()
            .filter(Map.class::isInstance)
            .map(Map.class::cast)
            .map(option -> EntityRepository.text(option.get("id")))
            .collect(java.util.stream.Collectors.toSet());
    }

    private String invalidValue() {
        throw ApiException.invalid("value does not match the field type");
    }

    private long next(List<Map<String, Object>> values, String key) {
        return values.stream().mapToLong(row -> Values.number(row.get(key), -1)).max().orElse(-1) + 1;
    }

    private String validLayout(String value) {
        if (!List.of("list", "matrix", "table", "board", "calendar").contains(value)) throw ApiException.invalid("layout is invalid");
        return value;
    }

    private String lowerEnum(Map<String, Object> body, String field, List<String> allowed, String fallback) {
        String value = Values.optional(body, field, 32, fallback).toLowerCase();
        if (!allowed.contains(value)) throw ApiException.invalid(field + " is invalid");
        return value;
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw ApiException.invalid("Invalid JSON field");
        }
    }

    private Map<String, Object> mapOf(Map<?, ?> input) {
        Map<String, Object> output = new LinkedHashMap<>();
        input.forEach((key, value) -> output.put(String.valueOf(key), value));
        return output;
    }

    private List<Object> channels(Map<String, Object> rule) {
        List<Object> channels = new java.util.ArrayList<>();
        if (Values.bool(rule.get("NotifyInApp"))) channels.add("inapp");
        if (Values.bool(rule.get("NotifyBrowser"))) channels.add("webpush");
        if (Values.bool(rule.get("NotifyEmail"))) channels.add("email");
        return channels;
    }

    private String emptyToNull(String value) {
        return value.isBlank() ? null : value;
    }

}
