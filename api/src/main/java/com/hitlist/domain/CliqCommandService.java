package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.DateTimeException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CliqCommandService {
    private final EntityRepository repository;
    private final TaskService tasks;
    private final ObjectMapper mapper;

    public CliqCommandService(EntityRepository repository, TaskService tasks, ObjectMapper mapper) {
        this.repository = repository;
        this.tasks = tasks;
        this.mapper = mapper.copy().enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
    }

    @Transactional
    public Map<String, Object> execute(String owner, Map<String, Object> command, Map<String, Object> identity) {
        exactKeys(command, Set.of("id", "accountId", "deviceId", "generation", "schemaVersion", "type", "payload", "expiresAt"));
        String id = requiredId(command, "id");
        String device = requiredId(command, "deviceId");
        String account = Values.required(command, "accountId", 30);
        if (!account.matches("[0-9]{5,30}") || !account.equals(identity.get("accountId"))
            || !device.equals(identity.get("deviceId"))) throw ApiException.unauthenticated();
        long generation = positiveInteger(command.get("generation"), "generation");
        if (!Long.valueOf(generation).equals(asLong(identity.get("generation")))) throw ApiException.unauthenticated();
        if (!Long.valueOf(1).equals(asLong(command.get("schemaVersion")))) throw ApiException.invalid("Unsupported schemaVersion");
        String type = Values.required(command, "type", 16);
        if (!Set.of("create", "list", "edit", "complete").contains(type)) throw ApiException.invalid("Unsupported command type");
        if (!(command.get("payload") instanceof Map<?, ?> rawPayload) || rawPayload.keySet().stream().anyMatch(key -> !(key instanceof String))) {
            throw ApiException.invalid("payload must be an object");
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        rawPayload.forEach((key, value) -> payload.put((String) key, value));
        Instant expires = Instant.ofEpochMilli(positiveInteger(command.get("expiresAt"), "expiresAt"));
        String key = digest(device + ":" + generation + ":" + id);
        String hash = digest(canonical(command));
        var prior = repository.find(StorageTables.CLIQ_COMMAND_RECEIPTS, owner, key);
        if (prior.isPresent()) {
            if (!hash.equals(prior.get().get("PayloadHash"))) throw ApiException.conflict("Command id already used with different content");
            return result(prior.get().get("Result"));
        }
        if (!expires.isAfter(Instant.now())) {
            Map<String, Object> expired = Map.of("status", "expired");
            repository.insert(StorageTables.CLIQ_COMMAND_RECEIPTS, owner, receipt(key, hash, expired));
            return expired;
        }
        repository.insert(StorageTables.CLIQ_COMMAND_RECEIPTS, owner, receipt(key, hash, Map.of("status", "pending")));
        Map<String, Object> result = switch (type) {
            case "create" -> create(owner, device, generation, id, payload);
            case "edit" -> edit(owner, payload, false);
            case "complete" -> edit(owner, payload, true);
            case "list" -> list(owner, payload, identity);
            default -> throw ApiException.invalid("Unsupported command type");
        };
        repository.replace(StorageTables.CLIQ_COMMAND_RECEIPTS, owner, key, receipt(key, hash, result));
        return result;
    }

    private Map<String, Object> create(String owner, String device, long generation, String id, Map<String, Object> payload) {
        allowedKeys(payload, Set.of("title", "dueDate", "dueTime"));
        UUID taskId = UUID.nameUUIDFromBytes((owner + ":" + device + ":" + generation + ":" + id).getBytes(StandardCharsets.UTF_8));
        Map<String, Object> body = new LinkedHashMap<>(payload);
        body.put("clientId", taskId.toString());
        return taskResult(tasks.create(owner, body));
    }

    private Map<String, Object> edit(String owner, Map<String, Object> payload, boolean complete) {
        allowedKeys(payload, complete ? Set.of("taskId", "expectedUpdatedAt")
            : Set.of("taskId", "expectedUpdatedAt", "title", "dueDate", "dueTime"));
        String taskId = requiredId(payload, "taskId");
        Object expected = payload.get("expectedUpdatedAt");
        if (!(expected instanceof String timestamp) || timestamp.isBlank()) throw ApiException.invalid("expectedUpdatedAt is required");
        Map<String, Object> current = tasks.get(owner, taskId);
        if (!timestamp.equals(current.get("updatedAt"))) throw ApiException.conflict("Task has changed");
        if (!complete && payload.keySet().stream().noneMatch(Set.of("title", "dueDate", "dueTime")::contains)) {
            throw ApiException.invalid("edit requires a changed field");
        }
        if (complete && "DONE".equals(current.get("status"))) throw ApiException.conflict("Task is already complete");
        if (complete) {
            List<Map<String, Object>> open = tasks.openNeeds(owner, taskId);
            if (!open.isEmpty()) {
                String names = open.stream().limit(3).map(task -> String.valueOf(task.get("title"))).collect(java.util.stream.Collectors.joining(", "))
                    + (open.size() > 3 ? " and " + (open.size() - 3) + " more" : "");
                throw ApiException.conflict("Task still needs " + names + " first. Finish those, or complete it in HitList.");
            }
        }
        Map<String, Object> changes = new LinkedHashMap<>(payload);
        changes.remove("taskId");
        changes.remove("expectedUpdatedAt");
        return taskResult(complete ? tasks.complete(owner, taskId) : tasks.update(owner, taskId, changes));
    }

    private Map<String, Object> list(String owner, Map<String, Object> payload, Map<String, Object> identity) {
        allowedKeys(payload, Set.of("filter", "page"));
        String filter = Values.required(payload, "filter", 16);
        if (!Set.of("open", "today", "overdue").contains(filter)) throw ApiException.invalid("Unsupported list filter");
        long page = payload.containsKey("page") ? positiveInteger(payload.get("page"), "page") : 1;
        if (page > 1000) throw ApiException.invalid("page is too large");
        if (!(identity.get("timeZone") instanceof String timezone)) throw ApiException.invalid("timeZone is required");
        ZoneId zone;
        try {
            zone = ZoneId.of(timezone);
        } catch (DateTimeException exception) {
            throw ApiException.invalid("Invalid timeZone");
        }
        Instant now = Instant.now();
        LocalDate today = now.atZone(zone).toLocalDate();
        List<Map<String, Object>> matches = tasks.list(owner, Map.of()).stream()
            .filter(task -> !"DONE".equals(task.get("status")))
            .filter(task -> {
                if (filter.equals("open")) return true;
                if (!(task.get("dueDate") instanceof String date) || date.isBlank()) return false;
                if (filter.equals("today")) return date.equals(today.toString());
                LocalTime time = task.get("dueTime") instanceof String dueTime && !dueTime.isBlank()
                    ? LocalTime.parse(dueTime) : LocalTime.of(23, 59, 59);
                return LocalDate.parse(date).atTime(time).atZone(zone).toInstant().isBefore(now);
            })
            .sorted(Comparator.comparing((Map<String, Object> task) -> (String) task.get("dueDate"), Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(task -> String.valueOf(task.get("id"))))
            .toList();
        int from = (int) Math.min(matches.size(), (page - 1) * 10);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> task : matches.subList(from, Math.min(matches.size(), from + 10))) items.add(taskFields(task));
        return Map.of("status", "applied", "tasks", items, "page", page, "hasMore", matches.size() > from + 10);
    }

    private Map<String, Object> taskResult(Map<String, Object> task) {
        return Map.of("status", "applied", "task", taskFields(task));
    }

    private Map<String, Object> taskFields(Map<String, Object> task) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (String field : List.of("id", "title", "status", "dueDate", "dueTime", "updatedAt")) fields.put(field.equals("id") ? "taskId" : field, task.get(field));
        return fields;
    }

    private Map<String, Object> receipt(String key, String hash, Map<String, Object> result) {
        return Map.of("CommandKey", key, "PayloadHash", hash, "Result", result);
    }

    private Map<String, Object> result(Object raw) {
        if (!(raw instanceof Map<?, ?> map) || !"applied".equals(map.get("status")) && !"expired".equals(map.get("status"))) {
            throw ApiException.unavailable("Command receipt is incomplete");
        }
        Map<String, Object> value = new LinkedHashMap<>();
        map.forEach((key, item) -> value.put(String.valueOf(key), item));
        return value;
    }

    private void exactKeys(Map<String, Object> body, Set<String> allowed) {
        if (!body.keySet().equals(allowed)) throw ApiException.invalid("Invalid command envelope");
    }

    private void allowedKeys(Map<String, Object> body, Set<String> allowed) {
        if (!allowed.containsAll(body.keySet())) throw ApiException.invalid("Unsupported payload field");
    }

    private String requiredId(Map<String, Object> body, String field) {
        String id = Values.required(body, field, 64);
        Values.id(id);
        return id;
    }

    private long positiveInteger(Object value, String field) {
        Long number = asLong(value);
        if (number == null || number < 1) throw ApiException.invalid(field + " must be a positive integer");
        return number;
    }

    private Long asLong(Object value) {
        if (!(value instanceof Number number) || !Double.isFinite(number.doubleValue())
            || number.doubleValue() != number.longValue() || number.longValue() > 9007199254740991L) return null;
        return number.longValue();
    }

    private String canonical(Map<String, Object> command) {
        try {
            return mapper.writeValueAsString(sorted(command));
        } catch (JsonProcessingException exception) {
            throw ApiException.invalid("Invalid command content");
        }
    }

    private Object sorted(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach((key, item) -> sorted.put(String.valueOf(key), sorted(item)));
            return sorted;
        }
        if (value instanceof List<?> list) return list.stream().map(this::sorted).toList();
        return value;
    }

    private String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}