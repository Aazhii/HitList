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

    private com.hitlist.storage.AutomationQueue automationQueue;
    private AutomationRunner automationRunner;

    public WorkspaceService(EntityRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    /** Set by Spring. Absent in tests that build the service by hand, where rules run through the older engine only. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setAutomationEngine(com.hitlist.storage.AutomationQueue queue, @org.springframework.context.annotation.Lazy AutomationRunner runner) {
        this.automationQueue = queue;
        this.automationRunner = runner;
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
            .map(row -> repairOptionIds(owner, row))
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("DefOrder"), 0)))
            .map(this::fieldApi)
            .toList();
    }

    /**
     * Self-heals a field whose options were stored before every option was
     * guaranteed an id (see normalizeOptions) — fixed in place on first read,
     * so a field created before that fix recovers on its own rather than
     * requiring the user to notice and re-save it.
     */
    private Map<String, Object> repairOptionIds(String owner, Map<String, Object> row) {
        List<Object> options = Values.jsonList(objectMapper, row.get("OptionsJson"));
        if (options.isEmpty()) return row;
        boolean needsRepair = options.stream().anyMatch(option ->
            option instanceof Map<?, ?> map && EntityRepository.text(mapOf(map).get("id")).isBlank());
        if (!needsRepair) return row;
        Map<String, Object> updated = new LinkedHashMap<>(row);
        updated.put("OptionsJson", json(normalizeOptions(options)));
        repository.replace(StorageTables.FIELD_DEFS, owner, EntityRepository.text(row.get("DefId")), updated);
        return updated;
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
        // Moments before this never fire (unless the rule asks to catch up), so a new rule does not announce old history.
        row.put("ActiveSince", now);
        repository.insert(StorageTables.RULES, owner, row);
        return ruleApi(row);
    }

    public Map<String, Object> updateRule(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> existing = repository.require(StorageTables.RULES, owner, id);
        Map<String, Object> row = ruleRow(body, existing);
        row.put("RuleId", id);
        row.put("UpdatedAt", System.currentTimeMillis());
        // A rule that was not running and now is starts from now; one that keeps running keeps its start.
        boolean wasActive = "active".equals(EntityRepository.text(existing.get("RuleStatus")));
        boolean isActive = "active".equals(EntityRepository.text(row.get("RuleStatus")));
        if (isActive && !wasActive) row.put("ActiveSince", System.currentTimeMillis());
        if (!isActive || !wasActive) row.put("LastError", "");
        repository.replace(StorageTables.RULES, owner, id, row);
        return ruleApi(row);
    }

    public void deleteRule(String owner, String id) {
        Values.id(id);
        repository.delete(StorageTables.RULES, owner, id);
        if (automationQueue != null) automationQueue.deleteRule(owner, id);
    }

    public List<Map<String, Object>> runs(String owner, String ruleId, int limit) {
        return repository.list(StorageTables.RUNS, owner).stream()
            .filter(row -> ruleId == null || ruleId.equals(EntityRepository.text(row.get("RuleId"))))
            .sorted(Comparator.comparingLong((Map<String, Object> row) -> Values.number(row.get("TriggeredAt"), 0)).reversed())
            .limit(Math.max(1, Math.min(limit, 100)))
            .map(this::runApi)
            .toList();
    }

    /** "Run now": delivers the rule's notification straight away, whatever its schedule. */
    public Map<String, Object> triggerRule(String owner, String ruleId) {
        Values.id(ruleId);
        Map<String, Object> rule = repository.require(StorageTables.RULES, owner, ruleId);
        String taskId = EntityRepository.text(rule.get("TaskId"));
        String title = EntityRepository.text(rule.get("Name"));
        if (!taskId.isBlank()) {
            title = repository.find(StorageTables.TASKS, owner, taskId).map(task -> EntityRepository.text(task.get("Title"))).orElse(title);
        }
        if (automationRunner != null && automationQueue != null && automationQueue.enabled()) {
            return runApi(automationRunner.runNow(owner, ruleId, System.currentTimeMillis()));
        }
        Map<String, Object> run = new AutomationDelivery(repository, objectMapper)
            .deliver(owner, rule, taskId, title, "Run by hand · " + EntityRepository.text(rule.get("Name")), "manual", "", System.currentTimeMillis(), Map.of());
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
                value.put("value", decode(fields.get(EntityRepository.text(row.get("DefId"))), EntityRepository.text(row.get("ValueText")), EntityRepository.text(row.get("EncodedKind"))));
                return value;
            })
            .filter(row -> row.get("value") != null)
            .toList();
    }

    private Map<String, Object> setValue(String owner, String subjectId, String fieldId, Map<String, Object> field, Object rawValue, String idKey) {
        String text = encode(field, rawValue);
        String kind = EntityRepository.text(field.get("FieldKind"));
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
            // The kind this value was written under — a later "change type"
            // never touches this row, it just makes the value unreadable
            // (cloaked, not deleted) until the field's kind matches again.
            row.put("EncodedKind", kind);
            row.put("UpdatedAt", System.currentTimeMillis());
            repository.insert(StorageTables.FIELD_VALUES, owner, row);
        } else {
            existing.put("ValueText", text);
            existing.put("EncodedKind", kind);
            existing.put("UpdatedAt", System.currentTimeMillis());
            repository.replace(StorageTables.FIELD_VALUES, owner, EntityRepository.text(existing.get("PropId")), existing);
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put(idKey, subjectId);
        response.put("fieldId", fieldId);
        response.put("value", text == null ? null : decode(field, text, kind));
        return response;
    }

    private Map<String, Object> viewRow(Map<String, Object> body, Map<String, Object> existing, long now) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("Name", body.containsKey("name") ? Values.required(body, "name", 100) : EntityRepository.text(row.get("Name")));
        row.put("ViewLayout", body.containsKey("layout") ? validLayout(Values.optional(body, "layout", 16, "list")) : EntityRepository.text(row.getOrDefault("ViewLayout", "list")));
        row.put("ScopeListId", body.containsKey("scopeListId") ? Values.optional(body, "scopeListId", 64, "") : EntityRepository.text(row.getOrDefault("ScopeListId", "")));
        row.put("ScopeDatabaseId", body.containsKey("scopeDatabaseId") ? Values.optional(body, "scopeDatabaseId", 64, "") : EntityRepository.text(row.getOrDefault("ScopeDatabaseId", "")));
        row.put("FilterJson", body.containsKey("filters") ? json(body.get("filters")) : EntityRepository.text(row.getOrDefault("FilterJson", "{}")));
        row.put("DisplayJson", body.containsKey("display") ? json(body.get("display")) : EntityRepository.text(row.getOrDefault("DisplayJson", "{\"hidden\":[],\"order\":[],\"widths\":{}}")));
        row.put("ShowDone", body.containsKey("showDone") ? Values.optionalBoolean(body, "showDone", false) : Values.bool(row.get("ShowDone")));
        return row;
    }

    private Map<String, Object> fieldRow(Map<String, Object> body, Map<String, Object> existing) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        String kind = body.containsKey("kind") ? Values.optional(body, "kind", 16, "") : EntityRepository.text(row.get("FieldKind"));
        if (!List.of("select", "multi", "number", "date", "checkbox", "text", "longtext").contains(kind)) throw ApiException.invalid("kind is invalid");
        // Changing kind never touches a single row_value — see decode()'s
        // EncodedKind check. Switching back to the old kind un-cloaks
        // everything exactly as it was, so this is safe to allow freely.
        row.put("Name", body.containsKey("name") ? Values.required(body, "name", 100) : EntityRepository.text(row.get("Name")));
        row.put("FieldKind", kind);
        row.put("OptionsJson", body.containsKey("options") ? json(normalizeOptions(body.get("options"))) : EntityRepository.text(row.getOrDefault("OptionsJson", "[]")));
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
        row.put("TitleLabel", body.containsKey("titleLabel") ? Values.optional(body, "titleLabel", 100, "Title") : EntityRepository.text(row.getOrDefault("TitleLabel", "Title")));
        return row;
    }

    private Map<String, Object> recordRow(Map<String, Object> body, Map<String, Object> existing) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("Title", body.containsKey("title") ? Values.required(body, "title", 255) : EntityRepository.text(row.get("Title")));
        return row;
    }

    /** Up to five steps, each a whole number of minutes within a year either side of the due time. */
    private static void validateOffsets(Object raw) {
        if (!(raw instanceof List<?> steps) || steps.size() > 5) {
            throw ApiException.invalid("offsetMinutes must be a list of at most 5 numbers");
        }
        for (Object step : steps) {
            if (!(step instanceof Number number) || number.doubleValue() != Math.rint(number.doubleValue())
                || Math.abs(number.doubleValue()) > 525_600) {
                throw ApiException.invalid("each offset must be a whole number of minutes, within a year");
            }
        }
    }

    private Map<String, Object> ruleRow(Map<String, Object> body, Map<String, Object> existing) {
        Map<String, Object> row = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        row.put("Name", body.containsKey("name") ? Values.required(body, "name", 255) : EntityRepository.text(row.get("Name")));
        row.put("Description", body.containsKey("description") ? Values.optional(body, "description", 2000, "") : EntityRepository.text(row.getOrDefault("Description", "")));
        row.put("TaskId", body.containsKey("taskId") ? Values.optional(body, "taskId", 64, "") : EntityRepository.text(row.getOrDefault("TaskId", "")));
        row.put("TriggerType", body.containsKey("triggerType") ? lowerEnum(body, "triggerType", List.of("due-date", "overdue", "recurring", "status-change", "daily-digest", "custom"), "due-date") : EntityRepository.text(row.getOrDefault("TriggerType", "due-date")));
        row.put("RuleStatus", body.containsKey("status") ? lowerEnum(body, "status", List.of("active", "paused", "draft"), "draft") : EntityRepository.text(row.getOrDefault("RuleStatus", "draft")));
        row.put("Urgency", body.containsKey("urgency") ? lowerEnum(body, "urgency", List.of("low", "medium", "high", "critical"), "medium") : EntityRepository.text(row.getOrDefault("Urgency", "medium")));
        if (body.containsKey("offsetMinutes")) validateOffsets(body.get("offsetMinutes"));
        row.put("OffsetSteps", body.containsKey("offsetMinutes") ? json(body.get("offsetMinutes")) : EntityRepository.text(row.getOrDefault("OffsetSteps", "[]")));
        Map<String, Object> recurrence = body.get("recurrence") instanceof Map<?, ?> map ? mapOf(map) : Map.of();
        row.put("RecurrenceFreq", recurrence.containsKey("frequency") ? EntityRepository.text(recurrence.get("frequency")) : EntityRepository.text(row.getOrDefault("RecurrenceFreq", "daily")));
        row.put("RecurrenceTime", recurrence.containsKey("time") ? EntityRepository.text(recurrence.get("time")) : EntityRepository.text(row.getOrDefault("RecurrenceTime", "")));
        row.put("RecurrenceDayOfWeek", recurrence.getOrDefault("dayOfWeek", row.getOrDefault("RecurrenceDayOfWeek", 0)));
        row.put("RecurrenceDayOfMonth", recurrence.getOrDefault("dayOfMonth", row.getOrDefault("RecurrenceDayOfMonth", 1)));
        row.put("NotifyInApp", body.containsKey("notifyInApp") ? Values.optionalBoolean(body, "notifyInApp", true) : Values.bool(row.getOrDefault("NotifyInApp", true)));
        row.put("NotifyBrowser", body.containsKey("notifyBrowser") ? Values.optionalBoolean(body, "notifyBrowser", false) : Values.bool(row.get("NotifyBrowser")));
        row.put("Timezone", body.containsKey("timezone") ? Values.optional(body, "timezone", 64, "") : EntityRepository.text(row.getOrDefault("Timezone", "")));
        row.put("NotifyEmail", body.containsKey("notifyEmail") ? Values.optionalBoolean(body, "notifyEmail", false) : Values.bool(row.get("NotifyEmail")));
        if (body.containsKey("spec")) {
            Map<String, Object> spec = AutomationSpecs.normalize(body.get("spec"));
            row.put("Spec", json(spec));
            row.put("TriggerType", "custom");
            // The old columns keep describing what the rule does in the old terms, so an older client still shows something true.
            java.util.List<?> actions = (java.util.List<?>) spec.get("actions");
            row.put("NotifyInApp", actions.stream().anyMatch(a -> "notify-in-app".equals(((Map<?, ?>) a).get("kind"))));
            row.put("NotifyBrowser", actions.stream().anyMatch(a -> "notify-browser".equals(((Map<?, ?>) a).get("kind"))));
        }
        return row;
    }

    private Map<String, Object> viewApi(Map<String, Object> row) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("id", EntityRepository.text(row.get("ViewId")));
        output.put("name", EntityRepository.text(row.get("Name")));
        output.put("layout", EntityRepository.text(row.get("ViewLayout")));
        output.put("scopeListId", emptyToNull(EntityRepository.text(row.get("ScopeListId"))));
        output.put("scopeDatabaseId", emptyToNull(EntityRepository.text(row.get("ScopeDatabaseId"))));
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
            "titleLabel", EntityRepository.text(row.getOrDefault("TitleLabel", "Title")),
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
        output.put("spec", AutomationSpecs.specOf(row, objectMapper));
        String lastError = EntityRepository.text(row.get("LastError"));
        if (!lastError.isBlank()) output.put("error", lastError);
        String zone = EntityRepository.text(row.get("Timezone"));
        if (!zone.isBlank()) output.put("timezone", zone);
        output.put("createdAt", Values.number(row.get("CreatedAt"), 0));
        output.put("updatedAt", Values.number(row.get("UpdatedAt"), 0));
        if (Values.number(row.get("LastTriggeredAt"), 0) > 0) output.put("lastTriggeredAt", Values.number(row.get("LastTriggeredAt"), 0));
        if (Values.number(row.get("NextTriggerAt"), 0) > 0) output.put("nextTriggerAt", Values.number(row.get("NextTriggerAt"), 0));
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
            // Same storage as text; the larger cap is the point of the kind.
            case "longtext" -> value instanceof String body && body.length() <= 10_000 ? body : invalidValue();
            case "number" -> value instanceof Number number && Double.isFinite(number.doubleValue()) ? String.valueOf(number) : invalidValue();
            case "date" -> value instanceof String date && date.matches("\\d{4}-\\d{2}-\\d{2}") ? date : invalidValue();
            case "checkbox" -> value instanceof Boolean flag ? flag ? "true" : null : invalidValue();
            case "select" -> value instanceof String selected && optionIds(options).contains(selected) ? selected : invalidValue();
            case "multi" -> value instanceof List<?> selected && selected.stream().allMatch(item -> item instanceof String id && optionIds(options).contains(id))
                ? json(selected) : invalidValue();
            default -> throw ApiException.invalid("Unknown field kind");
        };
    }

    /**
     * Two kinds that store the same bytes and accept the same values, so a
     * value written under one is still exactly right under the other.
     *
     * Only text and longtext qualify: they differ in how the cell is edited —
     * one line versus a wrapping box — not in what is stored. Cloaking on that
     * switch would blank a column for a presentation change, which is not what
     * the cloak is for.
     */
    private boolean interchangeable(String written, String current) {
        if (written.equals(current)) return true;
        List<String> textual = List.of("text", "longtext");
        return textual.contains(written) && textual.contains(current);
    }

    /**
     * `encodedKind` is the kind this value was actually written under — a
     * legacy row (written before this column existed) has none, and is
     * always readable, since we can't know its origin and shouldn't
     * retroactively hide old data. Once a value carries an EncodedKind, it
     * only decodes while the field's current kind still matches: changing
     * a field's type cloaks every value written under the old kind (as if
     * empty) without ever touching storage, and switching back uncloaks
     * them exactly as they were.
     */
    private Object decode(Map<String, Object> field, String text, String encodedKind) {
        if (text.isBlank()) return null;
        String kind = EntityRepository.text(field.get("FieldKind"));
        if (encodedKind != null && !encodedKind.isBlank() && !interchangeable(encodedKind, kind)) return null;
        return switch (kind) {
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

    /**
     * A select/multi field's options, each guaranteed a stable id.
     *
     * The client only sends an id for an option it already had (editing one
     * keeps it, so tasks that reference it stay attached); a freshly typed
     * option has none yet. Without this, a brand-new option was stored with
     * no id at all — every option on a field ended up with the same "missing"
     * identity, so picking any of them looked, to the value validator, like
     * picking none of them, and the value never saved.
     */
    private List<Object> normalizeOptions(Object rawOptions) {
        if (!(rawOptions instanceof List<?> list)) return List.of();
        List<Object> normalized = new java.util.ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) continue;
            Map<String, Object> option = mapOf(map);
            String id = EntityRepository.text(option.get("id"));
            option.put("id", id.isBlank() ? UUID.randomUUID().toString() : id);
            normalized.add(option);
        }
        return normalized;
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
