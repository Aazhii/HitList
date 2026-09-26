package com.hitlist.domain;

import com.hitlist.storage.StorageTables;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ListService {
    private final EntityRepository repository;

    public ListService(EntityRepository repository) {
        this.repository = repository;
    }

    public List<Map<String, Object>> list(String owner) {
        return repository.list(StorageTables.LISTS, owner).stream()
            .sorted(Comparator.comparingLong((Map<String, Object> list) -> Values.number(list.get("ListOrder"), 0))
                .thenComparingLong(list -> Values.number(list.get("CreatedAt"), 0)))
            .map(this::api)
            .toList();
    }

    public Map<String, Object> get(String owner, String id) {
        Values.id(id);
        return api(repository.require(StorageTables.LISTS, owner, id));
    }

    public Map<String, Object> create(String owner, Map<String, Object> body) {
        String clientId = Values.optional(body, "clientId", 64, "");
        if (!clientId.isBlank()) Values.id(clientId);
        long now = System.currentTimeMillis();
        Map<String, Object> list = new LinkedHashMap<>();
        list.put("ListId", clientId.isBlank() ? UUID.randomUUID().toString() : clientId);
        list.put("Name", Values.required(body, "name", 255));
        list.put("Color", Values.optional(body, "color", 32, "emerald"));
        list.put("ListOrder", Values.optionalLong(body, "listOrder", 0, Long.MIN_VALUE));
        list.put("CreatedAt", now);
        list.put("UpdatedAt", now);
        repository.insert(StorageTables.LISTS, owner, list);
        return api(list);
    }

    public Map<String, Object> update(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        Map<String, Object> updated = new LinkedHashMap<>(repository.require(StorageTables.LISTS, owner, id));
        if (body.containsKey("name")) updated.put("Name", Values.required(body, "name", 255));
        if (body.containsKey("color")) updated.put("Color", Values.optional(body, "color", 32, EntityRepository.text(updated.get("Color"))));
        if (body.containsKey("listOrder")) updated.put("ListOrder", Values.optionalLong(body, "listOrder", Values.number(updated.get("ListOrder"), 0), Long.MIN_VALUE));
        updated.put("UpdatedAt", System.currentTimeMillis());
        repository.replace(StorageTables.LISTS, owner, id, updated);
        return api(updated);
    }

    public void delete(String owner, String id) {
        Values.id(id);
        repository.require(StorageTables.LISTS, owner, id);
        for (Map<String, Object> task : repository.list(StorageTables.TASKS, owner)) {
            if (id.equals(EntityRepository.text(task.get("ListId")))) {
                String taskId = EntityRepository.text(task.get("TaskId"));
                repository.deleteRows(StorageTables.FIELD_VALUES, owner, row -> taskId.equals(EntityRepository.text(row.get("TaskId"))));
                repository.delete(StorageTables.TASKS, owner, taskId);
            }
        }
        repository.delete(StorageTables.LISTS, owner, id);
    }

    private Map<String, Object> api(Map<String, Object> list) {
        return Map.of(
            "id", EntityRepository.text(list.get("ListId")),
            "name", EntityRepository.text(list.get("Name")),
            "color", EntityRepository.text(list.get("Color")),
            "listOrder", Values.number(list.get("ListOrder"), 0),
            "createdAt", Values.iso(Values.number(list.get("CreatedAt"), 0)),
            "updatedAt", Values.iso(Values.number(list.get("UpdatedAt"), 0))
        );
    }
}
