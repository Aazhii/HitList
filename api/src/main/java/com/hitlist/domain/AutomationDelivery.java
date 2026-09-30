package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What happens when a rule fires: an in-app notification row, a note of the browser channel for
 * the client to raise (the server cannot show a browser notification itself), and a run row that
 * records what was and was not done. Email is not configured, so a rule that asks for it says so
 * in the run instead of pretending.
 */
public class AutomationDelivery {
    /** A run trail per owner is trimmed to this many rows. */
    static final int MAX_RUNS = 500;

    private final EntityRepository repository;
    private final ObjectMapper objectMapper;

    public AutomationDelivery(EntityRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    /** Delivers one firing and returns the run row. `fireKey` (may be blank) is what makes a firing happen once. */
    public Map<String, Object> deliver(
        String owner, Map<String, Object> rule, String taskId, String title, String body, String source, String fireKey, long now,
        Map<String, Object> extra
    ) {
        boolean inApp = Values.bool(rule.get("NotifyInApp"));
        boolean browser = Values.bool(rule.get("NotifyBrowser"));
        boolean email = Values.bool(rule.get("NotifyEmail"));
        List<String> delivered = new ArrayList<>();
        List<String> notes = new ArrayList<>();
        if (inApp) delivered.add("inapp");
        if (browser) delivered.add("webpush");
        if (email) notes.add("email is not configured, so it was not sent");

        if (!delivered.isEmpty()) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("ruleId", EntityRepository.text(rule.get("RuleId")));
            payload.put("urgency", EntityRepository.text(rule.get("Urgency")));
            payload.put("channels", delivered);
            if (!taskId.isBlank()) payload.put("taskId", taskId);
            payload.putAll(extra);
            Map<String, Object> notification = new LinkedHashMap<>();
            notification.put("NotificationId", UUID.randomUUID().toString());
            notification.put("Title", title);
            notification.put("Body", body);
            notification.put("Kind", "automation");
            notification.put("SourceType", taskId.isBlank() ? "rule" : "task");
            notification.put("SourceId", taskId.isBlank() ? EntityRepository.text(rule.get("RuleId")) : taskId);
            notification.put("ReadAt", 0);
            notification.put("CreatedAt", now);
            notification.put("Payload", json(payload));
            repository.insert(StorageTables.NOTIFICATIONS, owner, notification);
        }

        Map<String, Object> run = new LinkedHashMap<>();
        run.put("RunId", UUID.randomUUID().toString());
        run.put("RuleId", EntityRepository.text(rule.get("RuleId")));
        run.put("RuleName", EntityRepository.text(rule.get("Name")));
        run.put("TriggeredAt", now);
        run.put("RunStatus", delivered.isEmpty() ? "SKIPPED" : "SUCCESS");
        run.put("TriggerSource", source);
        run.put("Detail", (body.isBlank() ? title : body) + (notes.isEmpty() ? "" : " (" + String.join("; ", notes) + ")"));
        run.put("Channels", json(delivered));
        run.put("FireKey", fireKey);
        repository.insert(StorageTables.RUNS, owner, run);
        trim(owner);

        Map<String, Object> stored = repository.require(StorageTables.RULES, owner, EntityRepository.text(rule.get("RuleId")));
        stored.put("LastTriggeredAt", now);
        repository.replace(StorageTables.RULES, owner, EntityRepository.text(rule.get("RuleId")), stored);
        return run;
    }

    private void trim(String owner) {
        List<Map<String, Object>> runs = new ArrayList<>(repository.list(StorageTables.RUNS, owner));
        if (runs.size() <= MAX_RUNS) return;
        runs.sort((a, b) -> Long.compare(Values.number(b.get("TriggeredAt"), 0), Values.number(a.get("TriggeredAt"), 0)));
        for (Map<String, Object> stale : runs.subList(MAX_RUNS, runs.size())) {
            repository.delete(StorageTables.RUNS, owner, EntityRepository.text(stale.get("RunId")));
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw ApiException.invalid("Invalid JSON field");
        }
    }
}
