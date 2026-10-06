package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.web.ApiException;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The shape of an automation rule, version 2: where it looks (source and scope), what starts it (triggers), what must be true
 * (conditions), and what it does (actions). A rule saved before this existed has none of it stored; {@link #fromLegacy} reads
 * its old columns as the same shape, so every rule can be shown and edited the same way and nothing is rewritten until the
 * owner saves it.
 *
 * <pre>
 * { "version": 2,
 *   "source": "tasks",                                  // databases arrive later ("database:&lt;id&gt;")
 *   "scope": "personal" | "&lt;workspaceId&gt;",              // whose tasks it watches on this computer
 *   "subjectId": "",                                     // one task only, or blank for all
 *   "triggers": [ {kind, ...} ],  "conditions": [ {field, op, value} ],  "actions": [ {kind, ...} ],
 *   "options": { "catchUpMinutes": 120, "catchUp": false } }
 * </pre>
 */
public final class AutomationSpecs {
    public static final int VERSION = 2;
    static final Set<String> TRIGGERS = Set.of("date-reached", "every", "item-added", "field-edited", "status-becomes", "manual");
    static final Set<String> ACTIONS = Set.of("notify-in-app", "notify-browser", "notify-cliq", "set-status");
    static final Set<String> OPS = Set.of("is", "is-not", "contains", "starts-with", "is-empty", "is-set", "before", "after");
    static final Set<String> TASK_FIELDS = Set.of("title", "status", "quadrant", "listId", "category", "dueDate", "dueTime", "note", "priority");
    static final Set<String> STATUSES = Set.of("TODO", "IN_PROGRESS", "DONE");
    static final Set<String> FREQUENCIES = Set.of("daily", "weekdays", "weekly", "monthly");
    private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");
    private static final Pattern WORKSPACE = Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private static final Pattern SAFE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    public static final int MAX_TRIGGERS = 4;
    public static final int MAX_CONDITIONS = 8;
    public static final int MAX_ACTIONS = 5;
    public static final int MAX_TEMPLATE = 500;

    private AutomationSpecs() {
    }

    /** Validates a spec from a request and returns the clean version of it. Anything unknown is refused, never stored. */
    public static Map<String, Object> normalize(Object raw) {
        if (!(raw instanceof Map<?, ?> in)) throw ApiException.invalid("spec must be an object");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", VERSION);
        String source = str(in.get("source"), "tasks");
        if (!source.equals("tasks")) throw ApiException.invalid("source must be tasks");
        out.put("source", source);
        String scope = str(in.get("scope"), "personal");
        if (!scope.equals("personal") && !WORKSPACE.matcher(scope).matches()) throw ApiException.invalid("scope must be personal or a workspace id");
        out.put("scope", scope);
        String subject = str(in.get("subjectId"), "");
        if (!subject.isEmpty() && !SAFE_ID.matcher(subject).matches()) throw ApiException.invalid("subjectId is not valid");
        out.put("subjectId", subject);

        List<Map<String, Object>> triggers = new ArrayList<>();
        for (Object item : list(in.get("triggers"), MAX_TRIGGERS, "triggers")) triggers.add(trigger(item));
        if (triggers.isEmpty()) throw ApiException.invalid("a rule needs a trigger");
        out.put("triggers", triggers);

        List<Map<String, Object>> conditions = new ArrayList<>();
        for (Object item : list(in.get("conditions"), MAX_CONDITIONS, "conditions")) conditions.add(condition(item));
        out.put("conditions", conditions);

        List<Map<String, Object>> actions = new ArrayList<>();
        for (Object item : list(in.get("actions"), MAX_ACTIONS, "actions")) actions.add(action(item));
        if (actions.isEmpty()) throw ApiException.invalid("a rule needs an action");
        out.put("actions", actions);

        Map<?, ?> options = in.get("options") instanceof Map<?, ?> o ? o : Map.of();
        Map<String, Object> clean = new LinkedHashMap<>();
        clean.put("catchUpMinutes", intIn(options.get("catchUpMinutes"), 0, 10_080, 1440, "catchUpMinutes"));
        clean.put("catchUp", Boolean.TRUE.equals(options.get("catchUp")));
        out.put("options", clean);
        return out;
    }

    /** What an older rule means, in the same shape. */
    public static Map<String, Object> fromLegacy(Map<String, Object> row, ObjectMapper mapper) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", VERSION);
        out.put("source", "tasks");
        out.put("scope", "personal");
        out.put("subjectId", EntityRepository.text(row.get("TaskId")));
        String type = EntityRepository.text(row.get("TriggerType"));
        List<Map<String, Object>> triggers = new ArrayList<>();
        switch (type) {
            case "recurring", "daily-digest" -> {
                Map<String, Object> every = new LinkedHashMap<>();
                every.put("kind", "every");
                every.put("frequency", orElse(EntityRepository.text(row.get("RecurrenceFreq")), "daily"));
                every.put("time", orElse(EntityRepository.text(row.get("RecurrenceTime")), "09:00"));
                every.put("dayOfWeek", (int) Values.number(row.get("RecurrenceDayOfWeek"), 0));
                every.put("dayOfMonth", (int) Values.number(row.get("RecurrenceDayOfMonth"), 1));
                if ("daily-digest".equals(type)) every.put("digest", true);
                triggers.add(every);
            }
            case "status-change" -> {
                Map<String, Object> edited = new LinkedHashMap<>();
                edited.put("kind", "field-edited");
                edited.put("watch", List.of("status"));
                triggers.add(edited);
            }
            default -> {
                Map<String, Object> due = new LinkedHashMap<>();
                due.put("kind", "date-reached");
                due.put("field", "dueDate");
                List<Long> offsets = new ArrayList<>();
        for (Object step : Values.jsonList(mapper, row.get("OffsetSteps"))) if (step instanceof Number n) offsets.add(n.longValue());
                if (offsets.isEmpty()) offsets.add(0L);
                due.put("offsets", offsets);
                triggers.add(due);
            }
        }
        out.put("triggers", triggers);
        out.put("conditions", List.of());
        List<Map<String, Object>> actions = new ArrayList<>();
        if (Values.bool(row.get("NotifyInApp"))) actions.add(Map.of("kind", "notify-in-app"));
        if (Values.bool(row.get("NotifyBrowser"))) actions.add(Map.of("kind", "notify-browser"));
        if (actions.isEmpty()) actions.add(Map.of("kind", "notify-in-app"));
        out.put("actions", actions);
        // An older rule keeps its old window: moments up to two hours old still fire, never older.
        out.put("options", Map.of("catchUpMinutes", 120, "catchUp", false));
        return out;
    }

    /** The stored spec of a rule row, or its legacy meaning. */
    public static Map<String, Object> specOf(Map<String, Object> row, ObjectMapper mapper) {
        String stored = EntityRepository.text(row.get("Spec"));
        if (!stored.isBlank()) {
            try {
                Map<String, Object> parsed = mapper.readValue(stored, new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() { });
                if (parsed.get("triggers") instanceof List<?> && parsed.get("actions") instanceof List<?>) return parsed;
            } catch (JsonProcessingException unreadable) {
                // fall through to the old columns
            }
        }
        return fromLegacy(row, mapper);
    }

    // ── pieces ────────────────────────────────────────────────────────────────────────────────────────────────────────

    private static Map<String, Object> trigger(Object raw) {
        if (!(raw instanceof Map<?, ?> in)) throw ApiException.invalid("each trigger must be an object");
        String kind = str(in.get("kind"), "");
        if (!TRIGGERS.contains(kind)) throw ApiException.invalid("unknown trigger: " + kind);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", kind);
        switch (kind) {
            case "date-reached" -> {
                String field = str(in.get("field"), "dueDate");
                if (!field.equals("dueDate")) throw ApiException.invalid("date-reached works on the due date");
                out.put("field", field);
                List<Object> offsets = list(in.get("offsets"), 5, "offsets");
                if (offsets.isEmpty()) offsets = List.of(0);
                List<Long> clean = new ArrayList<>();
                for (Object offset : offsets) {
                    if (!(offset instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue()) || Math.abs(n.doubleValue()) > 525_600) {
                        throw ApiException.invalid("each offset must be a whole number of minutes, within a year");
                    }
                    if (!clean.contains(n.longValue())) clean.add(n.longValue());
                }
                out.put("offsets", clean);
            }
            case "every" -> {
                String frequency = str(in.get("frequency"), "daily");
                if (!FREQUENCIES.contains(frequency)) throw ApiException.invalid("frequency must be daily, weekdays, weekly or monthly");
                out.put("frequency", frequency);
                out.put("time", time(in.get("time"), "09:00"));
                out.put("dayOfWeek", intIn(in.get("dayOfWeek"), 0, 6, 1, "dayOfWeek"));
                out.put("dayOfMonth", intIn(in.get("dayOfMonth"), 1, 31, 1, "dayOfMonth"));
                if (Boolean.TRUE.equals(in.get("digest"))) out.put("digest", true);
            }
            case "field-edited" -> {
                List<String> watch = new ArrayList<>();
                for (Object field : list(in.get("watch"), 5, "watch")) {
                    String name = String.valueOf(field);
                    if (!TASK_FIELDS.contains(name)) throw ApiException.invalid("cannot watch " + name);
                    if (!watch.contains(name)) watch.add(name);
                }
                if (watch.isEmpty()) throw ApiException.invalid("choose a field to watch");
                out.put("watch", watch);
            }
            case "status-becomes" -> {
                String status = str(in.get("status"), "DONE");
                if (!STATUSES.contains(status)) throw ApiException.invalid("status must be TODO, IN_PROGRESS or DONE");
                out.put("status", status);
            }
            default -> { }
        }
        return out;
    }

    private static Map<String, Object> condition(Object raw) {
        if (!(raw instanceof Map<?, ?> in)) throw ApiException.invalid("each condition must be an object");
        String field = str(in.get("field"), "");
        String op = str(in.get("op"), "is");
        if (!TASK_FIELDS.contains(field)) throw ApiException.invalid("cannot test " + field);
        if (!OPS.contains(op)) throw ApiException.invalid("unknown condition: " + op);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("field", field);
        out.put("op", op);
        String value = str(in.get("value"), "");
        if (value.length() > 200) throw ApiException.invalid("a condition value is limited to 200 characters");
        out.put("value", value);
        return out;
    }

    private static Map<String, Object> action(Object raw) {
        if (!(raw instanceof Map<?, ?> in)) throw ApiException.invalid("each action must be an object");
        String kind = str(in.get("kind"), "");
        if (!ACTIONS.contains(kind)) throw ApiException.invalid("unknown action: " + kind);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", kind);
        switch (kind) {
            case "notify-in-app", "notify-browser" -> out.put("template", template(in.get("template")));
            case "notify-cliq" -> {
                out.put("template", template(in.get("template")));
                out.put("combine", !Boolean.FALSE.equals(in.get("combine")));
                String from = str(in.get("quietFrom"), "");
                String to = str(in.get("quietTo"), "");
                if (!from.isEmpty() || !to.isEmpty()) {
                    out.put("quietFrom", time(from, ""));
                    out.put("quietTo", time(to, ""));
                }
                out.put("dailyCap", intIn(in.get("dailyCap"), 1, 500, 30, "dailyCap"));
            }
            case "set-status" -> {
                String status = str(in.get("status"), "");
                if (!STATUSES.contains(status)) throw ApiException.invalid("status must be TODO, IN_PROGRESS or DONE");
                out.put("status", status);
            }
            default -> { }
        }
        return out;
    }

    private static String template(Object raw) {
        String text = str(raw, "");
        if (text.length() > MAX_TEMPLATE) throw ApiException.invalid("a message is limited to " + MAX_TEMPLATE + " characters");
        return text;
    }

    private static String time(Object raw, String fallback) {
        String text = str(raw, fallback);
        if (!TIME.matcher(text).matches()) throw ApiException.invalid("times are written HH:MM");
        LocalTime.parse(text);
        return text;
    }

    private static int intIn(Object raw, int min, int max, int fallback, String name) {
        if (raw == null) return fallback;
        if (!(raw instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue()) || n.intValue() < min || n.intValue() > max) {
            throw ApiException.invalid(name + " must be a whole number from " + min + " to " + max);
        }
        return n.intValue();
    }

    private static List<Object> list(Object raw, int max, String name) {
        if (raw == null) return List.of();
        if (!(raw instanceof List<?> items) || items.size() > max) throw ApiException.invalid(name + " must be a list of at most " + max);
        return new ArrayList<>(items);
    }

    private static String str(Object raw, String fallback) {
        return raw == null ? fallback : String.valueOf(raw).trim();
    }

    private static String orElse(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
