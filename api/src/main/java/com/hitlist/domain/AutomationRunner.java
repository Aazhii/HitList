package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.storage.AutomationQueue;
import com.hitlist.storage.StorageTables;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The automation engine. One tick a minute while HitList is open does two things:
 *
 * <ol>
 *   <li><b>Plan.</b> For each active rule it works out the moments that are due now or in the next two minutes (a due date plus
 *       offsets, a daily/weekly time, a status that just changed, an item that was just added or edited) and stores each in
 *       {@link AutomationQueue} with its <b>execute-at</b> time. A moment already stored is left alone, so a moment never runs
 *       twice, across ticks or restarts.</li>
 *   <li><b>Run.</b> It claims every stored moment whose execute-at has come ({@code now >= execute_at}), checks the rule's
 *       conditions on the item as it is <i>now</i>, runs the actions, and records the run. Each batch of actions, its run record
 *       and the queue rows' completion are one transaction, so a crash leaves nothing half done: the claim's lease runs out and
 *       the work is tried again, up to five times.</li>
 * </ol>
 *
 * Messages for the Cliq bot cannot be sent from here (the token and the sign-in live elsewhere), so the Cliq action writes an
 * outbox row for the desktop to deliver. Moments that came and went while the app was closed are not run late beyond the rule's
 * catch-up window; they are counted and recorded once as "missed", so nothing disappears silently.
 */
@Service
public class AutomationRunner {
    private static final Logger LOG = LoggerFactory.getLogger(AutomationRunner.class);
    /** Moments are stored a little before they are due, so each has its execute-at on record before it matters. */
    static final long LOOKAHEAD_MS = 120_000;
    static final long WEEK_MS = 7 * 24 * 60 * 60 * 1000L;
    private static final String INIT = "\u0000init";
    private static final int CLAIM_LIMIT = 200;
    private static final int MAX_ITEMS_IN_MESSAGE = 10;
    private static final long NOTIFICATION_TTL_MS = 30L * 24 * 60 * 60 * 1000;
    private static final int MAX_NOTIFICATIONS = 1000;
    private static final TypeReference<LinkedHashMap<String, Object>> MAP = new TypeReference<>() { };

    private final EntityRepository repository;
    private final AutomationQueue queue;
    private final ObjectMapper mapper;
    private final TaskService tasks;
    private final TransactionTemplate tx;
    private long lastHousekeeping;

    @Autowired
    public AutomationRunner(EntityRepository repository, AutomationQueue queue, ObjectMapper mapper, TaskService tasks,
        ObjectProvider<PlatformTransactionManager> manager) {
        this(repository, queue, mapper, tasks, manager.getIfAvailable());
    }

    public AutomationRunner(EntityRepository repository, AutomationQueue queue, ObjectMapper mapper, TaskService tasks, PlatformTransactionManager manager) {
        this.repository = repository;
        this.queue = queue;
        this.mapper = mapper;
        this.tasks = tasks;
        this.tx = manager == null ? null : new TransactionTemplate(manager);
    }

    /** One minute's work. Safe to call at any time and as often as wanted: planning and claiming are idempotent. */
    public void tick(long now) {
        if (!queue.enabled()) return;
        for (String owner : repository.owners(StorageTables.RULES)) {
            try {
                plan(owner, now);
            } catch (RuntimeException exception) {
                LOG.warn("automation planning failed for an owner: {}", exception.toString());
            }
        }
        for (Map<String, Object> failed : queue.releaseExpired(now)) {
            markError(String.valueOf(failed.get("owner")), String.valueOf(failed.get("rule")), "Stopped after " + AutomationQueue.MAX_ATTEMPTS + " tries; check the rule and run it again.");
        }
        consume(now);
        if (now - lastHousekeeping > 3_600_000) {
            lastHousekeeping = now;
            housekeeping(now);
        }
    }

    // ── planning ──────────────────────────────────────────────────────────────────────────────────────────────────────

    void plan(String owner, long now) {
        for (Map<String, Object> rule : repository.list(StorageTables.RULES, owner)) {
            if (!"active".equals(EntityRepository.text(rule.get("RuleStatus")))) continue;
            try {
                planRule(owner, rule, now);
            } catch (RuntimeException exception) {
                LOG.warn("automation rule {} could not be planned: {}", EntityRepository.text(rule.get("RuleId")), exception.toString());
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void planRule(String owner, Map<String, Object> rule, long now) {
        String ruleId = EntityRepository.text(rule.get("RuleId"));
        Map<String, Object> spec = AutomationSpecs.specOf(rule, mapper);
        ZoneId zone = zone(rule);
        Map<String, Object> options = (Map<String, Object>) spec.getOrDefault("options", Map.of());
        long catchUpMs = Values.number(options.get("catchUpMinutes"), 120) * 60_000L;
        long activeSince = Values.number(rule.get("ActiveSince"), Values.number(rule.get("CreatedAt"), 0));
        long floor = Boolean.TRUE.equals(options.get("catchUp")) ? now - catchUpMs : Math.max(activeSince, now - catchUpMs);
        String scopeOwner = scopeOwner(owner, spec);
        List<Map<String, Object>> subjects = subjects(scopeOwner, spec);
        long next = 0;
        long missed = 0;
        long checked = Values.number(rule.get("MissedCheckedAt"), activeSince);
        long missedUpTo = now - catchUpMs;

        for (Map<String, Object> trigger : (List<Map<String, Object>>) spec.get("triggers")) {
            String kind = String.valueOf(trigger.get("kind"));
            switch (kind) {
                case "date-reached" -> {
                    for (Map<String, Object> task : subjects) {
                        if ("DONE".equals(EntityRepository.text(task.get("Status")))) continue;
                        long due;
                        try { due = AutomationEngine.dueInstant(task, zone); } catch (java.time.DateTimeException invalid) { continue; }
                        if (due < 0) continue;
                        String taskId = EntityRepository.text(task.get("TaskId"));
                        for (Object raw : (List<Object>) trigger.getOrDefault("offsets", List.of(0))) {
                            long offset = ((Number) raw).longValue();
                            long at = due + offset * 60_000L;
                            String occurrence = due + "|" + offset;
                            if (at > now) next = next == 0 ? at : Math.min(next, at);
                            if (at <= now + LOOKAHEAD_MS && at >= floor) {
                                queue.enqueue(owner, ruleId, taskId, occurrence, at, json(Map.of("kind", "date", "dueAt", due, "offset", offset)), now);
                            } else if (at > Math.max(checked, activeSince) && at <= missedUpTo && !queue.exists(owner, ruleId, taskId, occurrence)) {
                                missed++;
                            }
                        }
                    }
                }
                case "every" -> {
                    LocalDate today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
                    long at = occurrenceOn(trigger, today, zone);
                    if (at >= 0 && at <= now + LOOKAHEAD_MS && at >= floor) {
                        queue.enqueue(owner, ruleId, "", today.toString(), at,
                            json(Map.of("kind", "every", "digest", Boolean.TRUE.equals(trigger.get("digest")))), now);
                    }
                    long upcoming = at > now ? at : nextOccurrence(trigger, now, zone);
                    if (upcoming > 0) next = next == 0 ? upcoming : Math.min(next, upcoming);
                }
                case "item-added", "field-edited", "status-becomes" -> watch(owner, ruleId, trigger, subjects, now);
                default -> { }
            }
        }

        if (missed > 0) {
            writeRun(owner, rule, "SKIPPED", "scheduler", missed + (missed == 1 ? " reminder was" : " reminders were")
                + " missed while HitList was closed and not run late", List.of(), "", now);
        }
        Map<String, Object> stored = repository.require(StorageTables.RULES, owner, ruleId);
        boolean dirty = false;
        if (Values.number(stored.get("NextTriggerAt"), 0) != next) { stored.put("NextTriggerAt", next); dirty = true; }
        if (missedUpTo > checked && Values.number(stored.get("MissedCheckedAt"), 0) != missedUpTo) { stored.put("MissedCheckedAt", missedUpTo); dirty = true; }
        if (dirty) repository.replace(StorageTables.RULES, owner, ruleId, stored);
    }

    /** Finds added / edited / status-changed items by comparing with what the rule saw last time. The first look only records. */
    @SuppressWarnings("unchecked")
    private void watch(String owner, String ruleId, Map<String, Object> trigger, List<Map<String, Object>> subjects, long now) {
        Map<String, String> seen = queue.seen(owner, ruleId);
        boolean initialised = seen.containsKey(INIT);
        String kind = String.valueOf(trigger.get("kind"));
        List<String> watched = "status-becomes".equals(kind) ? List.of("status")
            : "field-edited".equals(kind) ? (List<String>) trigger.get("watch") : List.of("status");
        java.util.Set<String> present = new java.util.HashSet<>();
        for (Map<String, Object> task : subjects) {
            String taskId = EntityRepository.text(task.get("TaskId"));
            present.add(taskId);
            Map<String, Object> snapshot = new java.util.TreeMap<>();
            for (String field : watched) snapshot.put(field, EntityRepository.text(task.get(taskKey(field))));
            String now1 = json(snapshot);
            String before = seen.get(taskId);
            if (initialised) {
                if (before == null && "item-added".equals(kind)) {
                    queue.enqueue(owner, ruleId, taskId, "added", now, json(Map.of("kind", "added")), now);
                } else if (before != null && !before.equals(now1)) {
                    if ("field-edited".equals(kind)) {
                        queue.enqueue(owner, ruleId, taskId, "edit|" + Integer.toHexString(now1.hashCode()) + "|" + now,
                            now, json(Map.of("kind", "edited", "before", before)), now);
                    } else if ("status-becomes".equals(kind)) {
                        String status = EntityRepository.text(task.get("Status"));
                        if (status.equals(trigger.get("status"))) {
                            queue.enqueue(owner, ruleId, taskId, "status|" + status + "|" + Values.number(task.get("UpdatedAt"), now),
                                now, json(Map.of("kind", "status", "status", status)), now);
                        }
                    }
                }
            }
            if (!now1.equals(before)) queue.putSeen(owner, ruleId, taskId, now1);
        }
        for (String gone : seen.keySet()) if (!INIT.equals(gone) && !present.contains(gone)) queue.removeSeen(owner, ruleId, gone);
        if (!initialised) queue.putSeen(owner, ruleId, INIT, "1");
    }

    // ── running ───────────────────────────────────────────────────────────────────────────────────────────────────────

    void consume(long now) {
        List<Map<String, Object>> claimed = queue.claim(now, CLAIM_LIMIT);
        if (claimed.isEmpty()) return;
        Map<String, List<Map<String, Object>>> byRule = new LinkedHashMap<>();
        for (Map<String, Object> row : claimed) byRule.computeIfAbsent(row.get("owner") + "\u0001" + row.get("rule"), k -> new ArrayList<>()).add(row);
        for (List<Map<String, Object>> group : byRule.values()) {
            try {
                runGroup(String.valueOf(group.get(0).get("owner")), String.valueOf(group.get(0).get("rule")), group, now);
            } catch (RuntimeException exception) {
                // Nothing was committed: the rows stay claimed, the lease runs out, and they are tried again.
                LOG.warn("automation run failed, it will be retried: {}", exception.toString());
            }
        }
    }

    private record Item(Map<String, Object> task, Map<String, Object> payload, Map<String, Object> row) { }

    @SuppressWarnings("unchecked")
    private void runGroup(String owner, String ruleId, List<Map<String, Object>> rows, long now) {
        var ruleOpt = repository.find(StorageTables.RULES, owner, ruleId);
        if (ruleOpt.isEmpty() || !"active".equals(EntityRepository.text(ruleOpt.get().get("RuleStatus")))) {
            inTransaction(() -> rows.forEach(r -> queue.finish(owner, ruleId, String.valueOf(r.get("subject")), String.valueOf(r.get("occurrence")), "skipped", now)));
            return;
        }
        Map<String, Object> rule = ruleOpt.get();
        Map<String, Object> spec = AutomationSpecs.specOf(rule, mapper);
        String scopeOwner = scopeOwner(owner, spec);
        List<Map<String, Object>> conditions = (List<Map<String, Object>>) spec.getOrDefault("conditions", List.of());
        List<Item> items = new ArrayList<>();
        List<Map<String, Object>> used = new ArrayList<>();
        List<Map<String, Object>> skipped = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> payload = parse(String.valueOf(row.get("payload")));
            String subject = String.valueOf(row.get("subject"));
            Map<String, Object> task = null;
            if (!subject.isEmpty()) {
                task = repository.find(StorageTables.TASKS, scopeOwner, subject).orElse(null);
                boolean dueMoment = "date".equals(payload.get("kind"));
                if (task == null || (dueMoment && "DONE".equals(EntityRepository.text(task.get("Status"))))) { skipped.add(row); continue; }
                final Map<String, Object> current = task;
                if (!conditions.stream().allMatch(c -> matches(current, c))) { skipped.add(row); continue; }
            }
            items.add(new Item(task, payload, row));
            used.add(row);
        }
        inTransaction(() -> {
            if (!items.isEmpty()) execute(owner, rule, spec, items, false, now);
            for (Map<String, Object> row : used) queue.finish(owner, ruleId, String.valueOf(row.get("subject")), String.valueOf(row.get("occurrence")), "done", now);
            for (Map<String, Object> row : skipped) queue.finish(owner, ruleId, String.valueOf(row.get("subject")), String.valueOf(row.get("occurrence")), "skipped", now);
        });
    }

    /** "Run now": runs the rule's actions once, by hand, on no particular item. */
    public Map<String, Object> runNow(String owner, String ruleId, long now) {
        Map<String, Object> rule = repository.require(StorageTables.RULES, owner, ruleId);
        Map<String, Object> spec = AutomationSpecs.specOf(rule, mapper);
        Map<String, Object>[] result = new Map[1];
        inTransaction(() -> result[0] = execute(owner, rule, spec, List.of(), true, now));
        return result[0];
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> execute(String owner, Map<String, Object> rule, Map<String, Object> spec, List<Item> items, boolean manual, long now) {
        String ruleId = EntityRepository.text(rule.get("RuleId"));
        String ruleName = EntityRepository.text(rule.get("Name"));
        ZoneId zone = zone(rule);
        String scopeOwner = scopeOwner(owner, spec);
        List<Map<String, Object>> actions = (List<Map<String, Object>>) spec.get("actions");
        List<String> channels = new ArrayList<>();
        List<String> notes = new ArrayList<>();
        // The run row is written first so a message queued below can point at it.
        String runId = UUID.randomUUID().toString();

        boolean inApp = actions.stream().anyMatch(a -> "notify-in-app".equals(a.get("kind")));
        boolean browser = actions.stream().anyMatch(a -> "notify-browser".equals(a.get("kind")));
        if (inApp || browser) {
            List<String> via = new ArrayList<>();
            if (inApp) via.add("inapp");
            if (browser) via.add("webpush");
            String template = actions.stream().filter(a -> "notify-in-app".equals(a.get("kind")) || "notify-browser".equals(a.get("kind")))
                .map(a -> String.valueOf(a.getOrDefault("template", ""))).filter(t -> !t.isBlank()).findFirst().orElse("");
            List<Item> shown = items.isEmpty() ? List.of(new Item(null, Map.of(), Map.of())) : items;
            for (Item item : shown) {
                String[] text = message(rule, item, manual, template, zone, scopeOwner);
                notify(owner, rule, item, text[0], text[1], via, now);
            }
            channels.addAll(via);
        }
        for (Map<String, Object> action : actions) {
            switch (String.valueOf(action.get("kind"))) {
                case "notify-cliq" -> {
                    String outcome = queueCliq(owner, rule, action, items, manual, zone, scopeOwner, runId, now);
                    if (outcome == null) channels.add("cliq"); else notes.add(outcome);
                }
                case "set-status" -> {
                    int changed = 0;
                    for (Item item : items) {
                        if (item.task() == null) continue;
                        String id = EntityRepository.text(item.task().get("TaskId"));
                        if (!String.valueOf(action.get("status")).equals(EntityRepository.text(item.task().get("Status")))) {
                            tasks.update(scopeOwner, id, Map.of("status", action.get("status")));
                            changed++;
                        }
                    }
                    if (changed > 0) channels.add("status");
                    else if (manual) notes.add("set status needs an item, so it did nothing by hand");
                }
                default -> { }
            }
        }
        String detail = (manual ? "Run by hand · " : items.size() > 1 ? items.size() + " items · " : items.size() == 1 && items.get(0).task() != null
            ? EntityRepository.text(items.get(0).task().get("Title")) + " · " : "") + ruleName;
        Map<String, Object> run = writeRun(owner, rule, channels.isEmpty() ? "SKIPPED" : "SUCCESS", manual ? "manual" : "scheduler",
            detail + (notes.isEmpty() ? "" : " (" + String.join("; ", notes) + ")"), channels,
            items.size() == 1 ? ruleId + "|" + items.get(0).row().get("subject") + "|" + items.get(0).row().get("occurrence") : "", now, runId);
        Map<String, Object> stored = repository.require(StorageTables.RULES, owner, ruleId);
        stored.put("LastTriggeredAt", now);
        stored.put("LastError", "");
        repository.replace(StorageTables.RULES, owner, ruleId, stored);
        return run;
    }

    // ── actions ───────────────────────────────────────────────────────────────────────────────────────────────────────

    private void notify(String owner, Map<String, Object> rule, Item item, String title, String body, List<String> via, long now) {
        String taskId = item.task() == null ? "" : EntityRepository.text(item.task().get("TaskId"));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("ruleId", EntityRepository.text(rule.get("RuleId")));
        payload.put("urgency", EntityRepository.text(rule.get("Urgency")));
        payload.put("channels", via);
        if (!taskId.isBlank()) payload.put("taskId", taskId);
        if (item.payload().get("dueAt") != null) {
            payload.put("dueAt", item.payload().get("dueAt"));
            long offset = Values.number(item.payload().get("offset"), 0);
            payload.put("minutesBefore", Math.max(0, -offset));
        }
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

    /** Queues a Cliq message for the desktop to deliver. Returns null when queued, or the reason it was not. */
    private String queueCliq(String owner, Map<String, Object> rule, Map<String, Object> action, List<Item> items, boolean manual,
        ZoneId zone, String scopeOwner, String runId, long now) {
        String ruleId = EntityRepository.text(rule.get("RuleId"));
        long dayStart = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli();
        int cap = (int) Values.number(action.get("dailyCap"), 30);
        if (!manual && queue.outboxSince(owner, ruleId, "cliq", dayStart) >= cap) return "Cliq daily limit of " + cap + " reached";
        String template = String.valueOf(action.getOrDefault("template", ""));
        boolean combine = !Boolean.FALSE.equals(action.get("combine"));
        List<String> messages = new ArrayList<>();
        if (manual || items.isEmpty()) {
            messages.add("🔔 " + EntityRepository.text(rule.get("Name")) + " · run by hand");
        } else if (combine && items.size() > 1) {
            StringBuilder text = new StringBuilder();
            String header = template.isBlank() ? "🔔 " + EntityRepository.text(rule.get("Name")) + " · {{count}} items" : template;
            text.append(header.replace("{{count}}", String.valueOf(items.size())).replace("{{rule}}", EntityRepository.text(rule.get("Name"))));
            int shown = 0;
            for (Item item : items) {
                if (shown++ >= MAX_ITEMS_IN_MESSAGE) break;
                text.append("\n• ").append(line(item, zone, scopeOwner));
            }
            if (items.size() > MAX_ITEMS_IN_MESSAGE) text.append("\nand ").append(items.size() - MAX_ITEMS_IN_MESSAGE).append(" more");
            messages.add(text.toString());
        } else {
            for (Item item : items) {
                String t = template.isBlank() ? "🔔 {{title}} — {{when}}" : template;
                messages.add(render(t, rule, item, zone, scopeOwner));
            }
        }
        long notBefore = quietUntil(action, zone, now);
        for (String text : messages) {
            String clipped = text.length() > 1900 ? text.substring(0, 1900) : text;
            queue.addOutbox(owner, ruleId, runId, "cliq", json(Map.of("text", clipped, "rule", EntityRepository.text(rule.get("Name")))), notBefore, now);
        }
        return null;
    }

    private static long quietUntil(Map<String, Object> action, ZoneId zone, long now) {
        String from = String.valueOf(action.getOrDefault("quietFrom", ""));
        String to = String.valueOf(action.getOrDefault("quietTo", ""));
        if (from.isEmpty() || to.isEmpty() || from.equals(to)) return 0;
        ZonedDateTime local = Instant.ofEpochMilli(now).atZone(zone);
        LocalTime t = local.toLocalTime();
        LocalTime start = LocalTime.parse(from);
        LocalTime end = LocalTime.parse(to);
        boolean quiet = start.isBefore(end) ? !t.isBefore(start) && t.isBefore(end) : !t.isBefore(start) || t.isBefore(end);
        if (!quiet) return 0;
        ZonedDateTime until = local.with(end);
        if (!until.isAfter(local)) until = until.plusDays(1);
        return until.toInstant().toEpochMilli();
    }

    // ── text ──────────────────────────────────────────────────────────────────────────────────────────────────────────

    /** Title and body of an in-app notification, in the words the older engine used when no template is set. */
    private String[] message(Map<String, Object> rule, Item item, boolean manual, String template, ZoneId zone, String scopeOwner) {
        String ruleName = EntityRepository.text(rule.get("Name"));
        if (manual) return new String[] { ruleName, "Run by hand · " + ruleName };
        if (!template.isBlank()) {
            String text = render(template, rule, item, zone, scopeOwner);
            return new String[] { item.task() == null ? ruleName : EntityRepository.text(item.task().get("Title")), text };
        }
        String kind = String.valueOf(item.payload().getOrDefault("kind", ""));
        return switch (kind) {
            case "date" -> new String[] { EntityRepository.text(item.task().get("Title")),
                AutomationEngine.timing(Values.number(item.payload().get("offset"), 0)) + " · " + ruleName };
            case "every" -> Boolean.TRUE.equals(item.payload().get("digest"))
                ? new String[] { "Daily digest", digestText(scopeOwner, zone) }
                : new String[] { ruleName, "Recurring reminder" };
            case "added" -> new String[] { EntityRepository.text(item.task().get("Title")), "Added · " + ruleName };
            case "status" -> new String[] { EntityRepository.text(item.task().get("Title")), "Now " + label(String.valueOf(item.payload().get("status"))) + " · " + ruleName };
            case "edited" -> new String[] { EntityRepository.text(item.task().get("Title")), "Changed · " + ruleName };
            default -> new String[] { ruleName, ruleName };
        };
    }

    private String line(Item item, ZoneId zone, String scopeOwner) {
        if (item.task() == null) return String.valueOf(item.payload().getOrDefault("kind", "item"));
        String title = EntityRepository.text(item.task().get("Title"));
        String due = dueText(item.task());
        return due.isEmpty() ? title : title + " · " + due;
    }

    private String render(String template, Map<String, Object> rule, Item item, ZoneId zone, String scopeOwner) {
        Map<String, Object> t = item.task() == null ? Map.of() : item.task();
        String when = switch (String.valueOf(item.payload().getOrDefault("kind", ""))) {
            case "date" -> AutomationEngine.timing(Values.number(item.payload().get("offset"), 0));
            case "added" -> "added";
            case "status" -> "now " + label(String.valueOf(item.payload().get("status")));
            case "edited" -> "changed";
            default -> "";
        };
        String list = "";
        String listId = EntityRepository.text(t.get("ListId"));
        if (!listId.isBlank()) list = repository.find(StorageTables.LISTS, scopeOwner, listId).map(l -> EntityRepository.text(l.get("Name"))).orElse("");
        return template
            .replace("{{title}}", EntityRepository.text(t.get("Title")))
            .replace("{{due}}", dueText(t))
            .replace("{{status}}", label(EntityRepository.text(t.get("Status"))))
            .replace("{{list}}", list)
            .replace("{{assignee}}", EntityRepository.text(t.get("AssigneeName")))
            .replace("{{when}}", when)
            .replace("{{rule}}", EntityRepository.text(rule.get("Name")))
            .replace("{{count}}", "1");
    }

    private String digestText(String scopeOwner, ZoneId zone) {
        LocalDate today = LocalDate.now(zone);
        int dueToday = 0;
        int overdue = 0;
        for (Map<String, Object> task : repository.list(StorageTables.TASKS, scopeOwner)) {
            if ("DONE".equals(EntityRepository.text(task.get("Status")))) continue;
            String date = EntityRepository.text(task.get("DueDate"));
            if (date.isBlank()) continue;
            LocalDate due;
            try { due = LocalDate.parse(date); } catch (java.time.DateTimeException invalid) { continue; }
            if (due.equals(today)) dueToday++;
            else if (due.isBefore(today)) overdue++;
        }
        return dueToday + " due today · " + overdue + " overdue";
    }

    private static String dueText(Map<String, Object> task) {
        String date = EntityRepository.text(task.get("DueDate"));
        String time = EntityRepository.text(task.get("DueTime"));
        return date.isBlank() ? "" : time.isBlank() ? date : date + " " + time;
    }

    private static String label(String status) {
        return switch (status) {
            case "DONE" -> "Done";
            case "IN_PROGRESS" -> "In progress";
            default -> "To do";
        };
    }

    // ── conditions ────────────────────────────────────────────────────────────────────────────────────────────────────

    static String taskKey(String field) {
        return switch (field) {
            case "title" -> "Title";
            case "status" -> "Status";
            case "quadrant" -> "Quadrant";
            case "listId" -> "ListId";
            case "category" -> "Category";
            case "dueDate" -> "DueDate";
            case "dueTime" -> "DueTime";
            case "note" -> "Note";
            case "priority" -> "TaskPriority";
            default -> field;
        };
    }

    static boolean matches(Map<String, Object> task, Map<String, Object> condition) {
        String actual = EntityRepository.text(task.get(taskKey(String.valueOf(condition.get("field")))));
        String wanted = String.valueOf(condition.getOrDefault("value", ""));
        return switch (String.valueOf(condition.get("op"))) {
            case "is" -> actual.equalsIgnoreCase(wanted);
            case "is-not" -> !actual.equalsIgnoreCase(wanted);
            case "contains" -> actual.toLowerCase().contains(wanted.toLowerCase());
            case "starts-with" -> actual.toLowerCase().startsWith(wanted.toLowerCase());
            case "is-empty" -> actual.isBlank();
            case "is-set" -> !actual.isBlank();
            case "before" -> !actual.isBlank() && actual.compareTo(wanted) < 0;
            case "after" -> !actual.isBlank() && actual.compareTo(wanted) > 0;
            default -> false;
        };
    }

    // ── time ──────────────────────────────────────────────────────────────────────────────────────────────────────────

    private ZoneId zone(Map<String, Object> rule) {
        String id = EntityRepository.text(rule.get("Timezone"));
        try {
            return id.isBlank() ? ZoneId.systemDefault() : ZoneId.of(id);
        } catch (RuntimeException exception) {
            return ZoneId.systemDefault();
        }
    }

    static long occurrenceOn(Map<String, Object> trigger, LocalDate day, ZoneId zone) {
        String time = String.valueOf(trigger.getOrDefault("time", ""));
        if (time.isBlank()) return -1;
        boolean runs = switch (String.valueOf(trigger.getOrDefault("frequency", "daily"))) {
            case "weekdays" -> day.getDayOfWeek() != DayOfWeek.SATURDAY && day.getDayOfWeek() != DayOfWeek.SUNDAY;
            case "weekly" -> day.getDayOfWeek().getValue() % 7 == Values.number(trigger.get("dayOfWeek"), 0);
            case "monthly" -> day.getDayOfMonth() == Math.min((int) Values.number(trigger.get("dayOfMonth"), 1), day.lengthOfMonth());
            default -> true;
        };
        if (!runs) return -1;
        return ZonedDateTime.of(day, LocalTime.parse(time), zone).toInstant().toEpochMilli();
    }

    static long nextOccurrence(Map<String, Object> trigger, long now, ZoneId zone) {
        LocalDate day = Instant.ofEpochMilli(now).atZone(zone).toLocalDate();
        for (int i = 0; i < 62; i++) {
            long at = occurrenceOn(trigger, day.plusDays(i), zone);
            if (at > now) return at;
        }
        return 0;
    }

    // ── housekeeping and helpers ──────────────────────────────────────────────────────────────────────────────────────

    private void housekeeping(long now) {
        queue.prune(now - WEEK_MS);
        for (String owner : repository.owners(StorageTables.RULES)) {
            List<Map<String, Object>> automatic = repository.list(StorageTables.NOTIFICATIONS, owner).stream()
                .filter(n -> "automation".equals(EntityRepository.text(n.get("Kind"))))
                .sorted(Comparator.comparingLong((Map<String, Object> n) -> Values.number(n.get("CreatedAt"), 0)).reversed()).toList();
            for (int i = 0; i < automatic.size(); i++) {
                boolean old = Values.number(automatic.get(i).get("CreatedAt"), 0) < now - NOTIFICATION_TTL_MS;
                if (i >= MAX_NOTIFICATIONS || old) repository.delete(StorageTables.NOTIFICATIONS, owner, EntityRepository.text(automatic.get(i).get("NotificationId")));
            }
        }
    }

    private Map<String, Object> writeRun(String owner, Map<String, Object> rule, String status, String source, String detail, List<String> channels,
        String fireKey, long now) {
        return writeRun(owner, rule, status, source, detail, channels, fireKey, now, UUID.randomUUID().toString());
    }

    private Map<String, Object> writeRun(String owner, Map<String, Object> rule, String status, String source, String detail, List<String> channels,
        String fireKey, long now, String runId) {
        Map<String, Object> run = new LinkedHashMap<>();
        run.put("RunId", runId);
        run.put("RuleId", EntityRepository.text(rule.get("RuleId")));
        run.put("RuleName", EntityRepository.text(rule.get("Name")));
        run.put("TriggeredAt", now);
        run.put("RunStatus", status);
        run.put("TriggerSource", source);
        run.put("Detail", detail);
        run.put("Channels", json(channels));
        run.put("FireKey", fireKey);
        repository.insert(StorageTables.RUNS, owner, run);
        trimRuns(owner);
        return run;
    }

    private void trimRuns(String owner) {
        List<Map<String, Object>> runs = new ArrayList<>(repository.list(StorageTables.RUNS, owner));
        if (runs.size() <= AutomationDelivery.MAX_RUNS) return;
        runs.sort((a, b) -> Long.compare(Values.number(b.get("TriggeredAt"), 0), Values.number(a.get("TriggeredAt"), 0)));
        for (Map<String, Object> stale : runs.subList(AutomationDelivery.MAX_RUNS, runs.size())) {
            repository.delete(StorageTables.RUNS, owner, EntityRepository.text(stale.get("RunId")));
        }
    }

    private void markError(String owner, String ruleId, String message) {
        repository.find(StorageTables.RULES, owner, ruleId).ifPresent(rule -> {
            Map<String, Object> next = new LinkedHashMap<>(rule);
            next.put("LastError", message);
            repository.replace(StorageTables.RULES, owner, ruleId, next);
        });
    }

    private String scopeOwner(String owner, Map<String, Object> spec) {
        String scope = String.valueOf(spec.getOrDefault("scope", "personal"));
        return "personal".equals(scope) ? owner : scope;
    }

    private List<Map<String, Object>> subjects(String scopeOwner, Map<String, Object> spec) {
        String only = String.valueOf(spec.getOrDefault("subjectId", ""));
        List<Map<String, Object>> all = repository.list(StorageTables.TASKS, scopeOwner);
        if (only.isBlank()) return all;
        return all.stream().filter(t -> only.equals(EntityRepository.text(t.get("TaskId")))).toList();
    }

    private void inTransaction(Runnable work) {
        if (tx == null) { work.run(); return; }
        tx.executeWithoutResult(status -> work.run());
    }

    private Map<String, Object> parse(String raw) {
        try {
            return mapper.readValue(raw, MAP);
        } catch (JsonProcessingException unreadable) {
            return new LinkedHashMap<>();
        }
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(exception);
        }
    }

    static boolean same(Object a, Object b) {
        return Objects.equals(a, b);
    }
}
