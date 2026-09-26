package com.hitlist.domain;

import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class NoteService {
    private final EntityRepository repository;

    public NoteService(EntityRepository repository) {
        this.repository = repository;
    }

    public List<Map<String, Object>> list(String owner) {
        return repository.list(StorageTables.NOTES, owner).stream()
            .sorted(Comparator.comparing((Map<String, Object> row) -> !Values.bool(row.get("Pinned")))
                .thenComparing(Comparator.comparingLong((Map<String, Object> row) -> Values.number(row.get("UpdatedAt"), 0)).reversed()))
            .map(this::api)
            .toList();
    }

    public Map<String, Object> get(String owner, String id) {
        Values.id(id);
        return api(repository.require(StorageTables.NOTES, owner, id));
    }

    public Map<String, Object> create(String owner, Map<String, Object> body) {
        String id = Values.required(body, "id", 64);
        Values.id(id);
        validateBlocks(body);
        long now = System.currentTimeMillis();
        Map<String, Object> existing = repository.find(StorageTables.NOTES, owner, id).orElse(null);
        Map<String, Object> note = build(existing, body, id, now);
        if (existing == null) {
            repository.insert(StorageTables.NOTES, owner, note);
            return api(note);
        }
        if (Values.number(note.get("UpdatedAt"), now) >= Values.number(existing.get("UpdatedAt"), 0)) {
            repository.replace(StorageTables.NOTES, owner, id, note);
            return api(note);
        }
        return api(existing);
    }

    public Map<String, Object> update(String owner, String id, Map<String, Object> body) {
        Values.id(id);
        validateBlocks(body);
        Map<String, Object> existing = repository.require(StorageTables.NOTES, owner, id);
        Map<String, Object> note = build(existing, body, id, System.currentTimeMillis());
        if (Values.number(note.get("UpdatedAt"), 0) >= Values.number(existing.get("UpdatedAt"), 0)) {
            repository.replace(StorageTables.NOTES, owner, id, note);
            return api(note);
        }
        return api(existing);
    }

    public void delete(String owner, String id) {
        Values.id(id);
        repository.delete(StorageTables.NOTES, owner, id);
    }

    private Map<String, Object> build(Map<String, Object> existing, Map<String, Object> body, String id, long now) {
        Map<String, Object> note = existing == null ? new LinkedHashMap<>() : new LinkedHashMap<>(existing);
        note.put("NoteId", id);
        note.put("Title", body.containsKey("title") ? Values.required(body, "title", 255) : EntityRepository.text(note.get("Title")));
        note.put("BlocksJson", body.containsKey("blocksJson") ? Values.optional(body, "blocksJson", 10_000, "") : EntityRepository.text(note.get("BlocksJson")));
        note.put("Emoji", body.containsKey("emoji") ? Values.optional(body, "emoji", 16, "📝") : EntityRepository.text(note.getOrDefault("Emoji", "📝")));
        note.put("Pinned", body.containsKey("pinned") ? Values.optionalBoolean(body, "pinned", false) : Values.bool(note.get("Pinned")));
        note.put("CreatedAt", body.containsKey("createdAt") ? Values.optionalLong(body, "createdAt", now, 0) : Values.number(note.get("CreatedAt"), now));
        note.put("UpdatedAt", body.containsKey("updatedAt") ? Values.optionalLong(body, "updatedAt", now, 0) : now);
        return note;
    }

    private void validateBlocks(Map<String, Object> body) {
        if (body.containsKey("blocksJson") && (!(body.get("blocksJson") instanceof String value) || value.length() > 10_000)) {
            throw ApiException.invalid("blocksJson must be a string of at most 10000 characters");
        }
    }

    private Map<String, Object> api(Map<String, Object> note) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("id", EntityRepository.text(note.get("NoteId")));
        output.put("title", EntityRepository.text(note.get("Title")));
        output.put("blocksJson", EntityRepository.text(note.get("BlocksJson")));
        output.put("emoji", EntityRepository.text(note.get("Emoji")));
        output.put("pinned", Values.bool(note.get("Pinned")));
        output.put("createdAt", Values.number(note.get("CreatedAt"), 0));
        output.put("updatedAt", Values.number(note.get("UpdatedAt"), 0));
        return output;
    }
}
