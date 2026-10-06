package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.SyncService;
import com.hitlist.storage.AutomationQueue;
import com.hitlist.storage.StorageTables;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Messages an automation rule wants delivered by the desktop (the Cliq bot). Desktop only: every call needs the shell's per-launch
 * token and a signed-in account. Same protocol as the overdue alerts: reserve a batch, check it is still wanted, then acknowledge
 * it as sent or hand it back to be retried.
 */
@RestController
@RequestMapping("/api/automations/outbox")
public class AutomationOutboxController {
    private final AutomationQueue queue;
    private final OwnerResolver owners;
    private final com.hitlist.domain.EntityRepository repository;

    public AutomationOutboxController(AutomationQueue queue, OwnerResolver owners, com.hitlist.domain.EntityRepository repository) {
        this.queue = queue;
        this.owners = owners;
        this.repository = repository;
    }

    private String account(HttpServletRequest request) {
        String account = owners.desktopOwner(request);
        if (account == null || !queue.enabled()) throw ApiException.unauthenticated();
        return account;
    }

    private static String batch(Map<String, Object> body) {
        String value = String.valueOf(body.get("batchId"));
        if (!value.matches("[a-f0-9-]{36}")) throw ApiException.invalid("Invalid batch");
        return value;
    }

    /** Messages that may go now, reserved for two minutes. */
    @PostMapping("/reserve")
    public Map<String, Object> reserve(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return queue.reserveOutbox(account(request), "cliq", System.currentTimeMillis(), 10);
    }

    /** The reserved messages whose rule is still active (a rule paused or deleted since is not delivered). */
    @PostMapping("/validate")
    public Map<String, Object> validate(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String owner = account(request);
        List<Map<String, Object>> live = queue.reservedOutbox(owner, batch(body), System.currentTimeMillis()).stream()
            .filter(item -> repository.find(StorageTables.RULES, owner, String.valueOf(item.get("ruleId")))
                .map(rule -> "active".equals(String.valueOf(rule.get("RuleStatus")))).orElse(false))
            .toList();
        return Map.of("items", live);
    }

    @PostMapping({ "/ack", "/retry" })
    public Map<String, Object> finish(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String owner = account(request);
        if (!(body.get("ids") instanceof List<?> ids) || ids.size() > 20) throw ApiException.invalid("Invalid ids");
        List<String> clean = ids.stream().map(String::valueOf).filter(id -> id.matches("[a-f0-9-]{36}")).toList();
        queue.finishOutbox(owner, batch(body), clean, request.getRequestURI().endsWith("/ack"), System.currentTimeMillis());
        return Map.of("ok", true);
    }
}
