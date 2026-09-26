package com.hitlist.domain;

import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import org.springframework.stereotype.Service;

@Service
public class TaskService {
    private static final Set<String> STATUSES = Set.of("TODO", "IN_PROGRESS", "DONE");
    private static final Set<String> QUADRANTS = Set.of("DO", "SCHEDULE", "DELEGATE", "ELIMINATE");
    private static final Set<String> PRIORITIES = Set.of("LOW", "MEDIUM", "HIGH");
    private final EntityRepository repository;

    public TaskService(EntityRepository repository) {
        this.repository = repository;
    }

    public List<Map<String, Object>> list(String owner, Map<String, String> query) {
        List<Map<String, Object>> tasks = repository.list(StorageTables.TASKS, owner).stream()
            .filter(task -> activeList(owner, text(task, "ListId")))
            .filter(filter(query))
            .sorted(comparator(query.getOrDefault("sortBy", "order"), query.get("sortDir")))
            .map(this::api)
            .toList();
        return tasks;
    }

    public Map<String, Object> get(String owner, String id) {
        Values.id(id);
        return api(repository.require(StorageTables.TASKS, owner, id));
    }

    public Map<String, Object> create(String owner, Map<String, Object> body) {
        String title = Values.required(body, "title", 255);
        String listId = Values.optional(body, "listId", 64, "");
        if (!listId.isBlank() && repository.find(StorageTables.LISTS, owner, listId).isEmpty()) {
            throw ApiException.notFound();
        }
        long now = System.currentTimeMillis();
        Map<String, Object> task = new LinkedHashMap<>();
        task.put("TaskId", requestedId(body, "clientId"));
        task.put("Title", title);
        String status = Values.enumValue(body, "status", STATUSES, "TODO");
        task.put("Status", status);
        task.put("Quadrant", Values.enumValue(body, "quadrant", QUADRANTS, "SCHEDULE"));
        task.put("TaskPriority", optionalPriority(body, ""));
        task.put("Note", Values.optional(body, "note", 10_000, ""));
        task.put("DueDate", Values.date(body, "dueDate", ""));
        task.put("DueTime", Values.time(body, "dueTime", ""));
        task.put("Category", Values.optional(body, "category", 100, ""));
        task.put("ListId", listId);
        task.put("TaskOrder", Values.optionalLong(body, "taskOrder", 0, Long.MIN_VALUE));
        task.put("ReminderEnabled", false);
        task.put("ReminderMinutesBefore", 0);
        task.put("CompletedAt", completionTime(body, status, now));
        task.put("CreatedAt", now);
        task.put("UpdatedAt", now);
        task.put("SourceNoteId", optionalId(body, "sourceNoteId", ""));
        task.put("SourceBlockId", optionalId(body, "sourceBlockId", ""));
        repository.insert(StorageTables.TASKS, owner, task);
        return api(task);
    }

    public Map<String, Object> update(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> existing = repository.require(StorageTables.TASKS, owner, id);
        Map<String, Object> updated = new LinkedHashMap<>(existing);
        patch(updated, body);
        String listId = text(updated, "ListId");
        if (!listId.isBlank() && repository.find(StorageTables.LISTS, owner, listId).isEmpty()) {
            throw ApiException.notFound();
        }
        updated.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.TASKS, owner, id, updated);
        return api(updated);
    }

    public Map<String, Object> status(String owner, String id, String status) {
        return update(owner, id, Map.of("status", status));
    }

    public Map<String, Object> complete(String owner, String id) {
        Values.id(id);
        Map<String, Object> existing = repository.require(StorageTables.TASKS, owner, id);
        Map<String, Object> updated = new LinkedHashMap<>(existing);
        updated.put("Status", "DONE");
        updated.put("CompletedAt", System.currentTimeMillis());
        updated.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.TASKS, owner, id, updated);
        return api(updated);
    }

    public Map<String, Object> quadrant(String owner, String id, String quadrant) {
        return update(owner, id, Map.of("quadrant", quadrant));
    }

    public void delete(String owner, String id) {
        Values.id(id);
        repository.deleteRows(StorageTables.FIELD_VALUES, owner, row -> id.equals(text(row, "TaskId")));
        repository.delete(StorageTables.TASKS, owner, id);
    }

    public List<Map<String, Object>> todayHistory(String owner, String listId, String timeZone) {
        LocalDate today = LocalDate.now(Values.zone(timeZone));
        return repository.list(StorageTables.TASKS, owner).stream()
            .filter(task -> "DONE".equals(text(task, "Status")) && Values.number(task.get("CompletedAt"), 0) > 0)
            .filter(task -> listId == null || listId.isBlank() || listId.equals(text(task, "ListId")))
            .filter(task -> Instant.ofEpochMilli(Values.number(task.get("CompletedAt"), 0)).atZone(Values.zone(timeZone)).toLocalDate().equals(today))
            .sorted(Comparator.comparingLong((Map<String, Object> task) -> Values.number(task.get("CompletedAt"), 0)).reversed())
            .map(this::api)
            .toList();
    }

    public Map<String, Object> momentum(String owner, String listId, String timeZone) {
        ZoneId zone = Values.zone(timeZone);
        LocalDate today = LocalDate.now(zone);
        List<Map<String, Object>> done = repository.list(StorageTables.TASKS, owner).stream()
            .filter(task -> "DONE".equals(text(task, "Status")))
            .filter(task -> listId == null || listId.isBlank() || listId.equals(text(task, "ListId")))
            .toList();
        Set<LocalDate> dates = new HashSet<>();
        for (Map<String, Object> task : done) {
            long completedAt = Values.number(task.get("CompletedAt"), 0);
            if (completedAt > 0) {
                dates.add(Instant.ofEpochMilli(completedAt).atZone(zone).toLocalDate());
            }
        }
        int streak = 0;
        for (LocalDate date = today; dates.contains(date); date = date.minusDays(1)) {
            streak++;
        }
        return Map.of(
            "streak", streak,
            "totalCompleted", done.size(),
            "todayCompleted", (int) dates.stream().filter(today::equals).count(),
            "listId", listId == null ? "" : listId,
            "asOf", Instant.now().toString()
        );
    }

    private void patch(Map<String, Object> task, Map<String, Object> body) {
        if (body.containsKey("title")) task.put("Title", Values.required(body, "title", 255));
        if (body.containsKey("status")) {
            String status = Values.enumValue(body, "status", STATUSES, text(task, "Status"));
            task.put("Status", status);
            task.put("CompletedAt", completionTime(body, status, Math.max(Values.number(task.get("CompletedAt"), 0), System.currentTimeMillis())));
        } else if (body.containsKey("completedAt")) {
            if (!"DONE".equals(text(task, "Status"))) {
                throw ApiException.invalid("completedAt is only allowed for DONE tasks");
            }
            task.put("CompletedAt", Values.optionalTimestamp(body, "completedAt", Values.number(task.get("CompletedAt"), 0)));
        }
        if (body.containsKey("quadrant")) task.put("Quadrant", Values.enumValue(body, "quadrant", QUADRANTS, text(task, "Quadrant")));
        if (body.containsKey("priority")) task.put("TaskPriority", optionalPriority(body, text(task, "TaskPriority")));
        if (body.containsKey("note")) task.put("Note", Values.optional(body, "note", 10_000, text(task, "Note")));
        if (body.containsKey("dueDate")) task.put("DueDate", Values.date(body, "dueDate", text(task, "DueDate")));
        if (body.containsKey("dueTime")) task.put("DueTime", Values.time(body, "dueTime", text(task, "DueTime")));
        if (body.containsKey("category")) task.put("Category", Values.optional(body, "category", 100, text(task, "Category")));
        if (body.containsKey("listId")) task.put("ListId", Values.optional(body, "listId", 64, text(task, "ListId")));
        if (body.containsKey("taskOrder")) task.put("TaskOrder", Values.optionalLong(body, "taskOrder", Values.number(task.get("TaskOrder"), 0), Long.MIN_VALUE));
        task.put("ReminderEnabled", false);
        task.put("ReminderMinutesBefore", 0);
        if (body.containsKey("sourceNoteId")) task.put("SourceNoteId", optionalId(body, "sourceNoteId", text(task, "SourceNoteId")));
        if (body.containsKey("sourceBlockId")) task.put("SourceBlockId", optionalId(body, "sourceBlockId", text(task, "SourceBlockId")));
    }

    private Predicate<Map<String, Object>> filter(Map<String, String> query) {
        return task -> {
            if (query.containsKey("listId") && !query.get("listId").equals(text(task, "ListId"))) return false;
            if (!matchesAny(query.get("status"), text(task, "Status"))) return false;
            if (!matchesAny(query.get("priority"), text(task, "TaskPriority"))) return false;
            if (!matchesAny(query.get("quadrant"), text(task, "Quadrant"))) return false;
            String search = query.get("search");
            if (search != null && !search.isBlank()) {
                String needle = search.toLowerCase();
                if (!(text(task, "Title") + "\n" + text(task, "Note") + "\n" + text(task, "Category")).toLowerCase().contains(needle)) return false;
            }
            String dueDate = text(task, "DueDate");
            return (!query.containsKey("dueAfter") || (!dueDate.isBlank() && dueDate.compareTo(query.get("dueAfter")) >= 0))
                && (!query.containsKey("dueBefore") || (!dueDate.isBlank() && dueDate.compareTo(query.get("dueBefore")) <= 0));
        };
    }

    private Comparator<Map<String, Object>> comparator(String sortBy, String sortDir) {
        Comparator<Map<String, Object>> comparator = switch (sortBy) {
            case "title" -> Comparator.comparing(task -> text(task, "Title"), String.CASE_INSENSITIVE_ORDER);
            case "due-date" -> Comparator.comparing(task -> {
                String date = text(task, "DueDate");
                return date.isBlank() ? "9999-12-31" : date;
            });
            case "priority" -> Comparator.comparingInt(task -> priorityOrder(text(task, "TaskPriority")));
            case "status" -> Comparator.comparingInt(task -> statusOrder(text(task, "Status")));
            case "created" -> Comparator.comparingLong(task -> Values.number(task.get("CreatedAt"), 0));
            default -> Comparator.comparingLong((Map<String, Object> task) -> Values.number(task.get("TaskOrder"), 0))
                .thenComparingLong(task -> Values.number(task.get("CreatedAt"), 0));
        };
        return "desc".equalsIgnoreCase(sortDir) ? comparator.reversed() : comparator;
    }

    private boolean activeList(String owner, String listId) {
        return listId.isBlank() || repository.find(StorageTables.LISTS, owner, listId).isPresent();
    }

    private boolean matchesAny(String values, String current) {
        return values == null || values.isBlank() || java.util.Arrays.stream(values.split(","))
            .map(value -> value.trim().toUpperCase())
            .anyMatch(value -> value.equals(current.toUpperCase()));
    }

    private int priorityOrder(String priority) {
        return switch (priority) { case "HIGH" -> 0; case "MEDIUM" -> 1; case "LOW" -> 2; default -> 3; };
    }

    private int statusOrder(String status) {
        return switch (status) { case "IN_PROGRESS" -> 0; case "TODO" -> 1; default -> 2; };
    }

    private String requestedId(Map<String, Object> body, String field) {
        String id = Values.optional(body, field, 64, "");
        if (!id.isBlank()) Values.id(id);
        return id.isBlank() ? UUID.randomUUID().toString() : id;
    }

    private String optionalId(Map<String, Object> body, String field, String fallback) {
        String value = Values.optional(body, field, 64, fallback);
        if (!value.isBlank()) Values.id(value);
        return value;
    }

    private String optionalPriority(Map<String, Object> body, String fallback) {
        if (!body.containsKey("priority") || body.get("priority") == null) return fallback;
        if ("".equals(body.get("priority"))) return "";
        return Values.enumValue(body, "priority", PRIORITIES, fallback);
    }

    private long completionTime(Map<String, Object> body, String status, long fallback) {
        if (!"DONE".equals(status)) {
            if (body.containsKey("completedAt") && Values.optionalTimestamp(body, "completedAt", 0) != 0) {
                throw ApiException.invalid("completedAt is only allowed for DONE tasks");
            }
            return 0;
        }
        return Values.optionalTimestamp(body, "completedAt", fallback);
    }

    private Map<String, Object> api(Map<String, Object> task) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("id", text(task, "TaskId"));
        output.put("title", text(task, "Title"));
        output.put("status", text(task, "Status"));
        output.put("quadrant", text(task, "Quadrant"));
        output.put("priority", nullable(task, "TaskPriority"));
        output.put("note", nullable(task, "Note"));
        output.put("dueDate", nullable(task, "DueDate"));
        output.put("dueTime", nullable(task, "DueTime"));
        output.put("category", nullable(task, "Category"));
        output.put("listId", nullable(task, "ListId"));
        output.put("taskOrder", Values.number(task.get("TaskOrder"), 0));
        output.put("reminderEnabled", false);
        output.put("reminderMinutesBefore", null);
        output.put("completedAt", Values.iso(Values.number(task.get("CompletedAt"), 0)));
        output.put("createdAt", Values.iso(Values.number(task.get("CreatedAt"), 0)));
        output.put("updatedAt", Values.iso(Values.number(task.get("UpdatedAt"), 0)));
        output.put("sourceNoteId", nullable(task, "SourceNoteId"));
        output.put("sourceBlockId", nullable(task, "SourceBlockId"));
        return output;
    }

    private String text(Map<String, Object> row, String field) {
        return EntityRepository.text(row.get(field));
    }

    private String nullable(Map<String, Object> row, String field) {
        String value = text(row, field);
        return value.isBlank() ? null : value;
    }
}
