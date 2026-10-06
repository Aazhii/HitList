package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.SyncService;
import com.hitlist.storage.DueScheduleStore;
import jakarta.servlet.http.HttpServletRequest;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/overdue")
public class OverdueController {
    private final DueScheduleStore schedules;
    private final OwnerResolver owners;
    private final SyncService sync;

    public OverdueController(DueScheduleStore schedules, OwnerResolver owners, SyncService sync) {
        this.schedules = schedules;
        this.owners = owners;
        this.sync = sync;
    }

    private String[] context(Map<String, Object> body, HttpServletRequest request) {
        String account = owners.desktopOwner(request);
        if (account == null) throw ApiException.unauthenticated();
        Object requested = body.get("workspaceId");
        String workspace = requested == null ? account : String.valueOf(requested);
        if (!workspace.matches("[A-Za-z0-9_-]{43}")) throw ApiException.invalid("Invalid workspace");
        if (!workspace.equals(account) && !sync.canUse(account, workspace, false)) throw ApiException.forbidden();
        return new String[] { account, workspace };
    }

    private String batch(Map<String, Object> body) {
        String value = String.valueOf(body.get("batchId"));
        if (!value.matches("[a-f0-9-]{36}")) throw ApiException.invalid("Invalid batch");
        return value;
    }

    @PostMapping("/reserve")
    public Map<String, Object> reserve(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String[] context = context(body, request);
        ZoneId zone;
        try { zone = ZoneId.of(String.valueOf(body.get("timezone"))); }
        catch (java.time.DateTimeException invalid) { throw ApiException.invalid("Invalid timezone"); }
        return schedules.reserve(context[0], context[1], zone, System.currentTimeMillis());
    }

    @PostMapping("/validate")
    public Map<String, Object> validate(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String[] context = context(body, request);
        return Map.of("tasks", schedules.validate(context[0], context[1], batch(body), System.currentTimeMillis()));
    }

    @PostMapping({ "/ack", "/retry" })
    public Map<String, Object> finish(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String[] context = context(body, request);
        if (!(body.get("tasks") instanceof List<?> entries) || entries.size() > 20) throw ApiException.invalid("Invalid tasks");
        List<Map<String, Object>> tasks = entries.stream().map(entry -> {
            if (!(entry instanceof Map<?, ?> task) || !(task.get("id") instanceof String id)
                || !(task.get("occurrence") instanceof String occurrence) || id.length() > 64 || occurrence.length() > 64) {
                throw ApiException.invalid("Invalid occurrence");
            }
            return Map.<String, Object>of("id", id, "occurrence", occurrence);
        }).toList();
        schedules.finish(context[0], context[1], batch(body), tasks, request.getRequestURI().endsWith("/ack"), System.currentTimeMillis());
        return Map.of("ok", true);
    }
}