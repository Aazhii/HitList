package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.SyncService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Shared workspaces on this device. Desktop only: every call needs the shell's per-launch token and a signed-in account,
 * so a web page or another program on the computer cannot read or change the copies.
 */
@RestController
@RequestMapping("/api/sync")
public class SyncController {
    private final OwnerResolver owners;
    private final SyncService sync;

    public SyncController(OwnerResolver owners, SyncService sync) {
        this.owners = owners;
        this.sync = sync;
    }

    private String account(HttpServletRequest request) {
        String account = owners.desktopOwner(request);
        if (account == null) throw ApiException.unauthenticated();
        return account;
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    @GetMapping("/workspaces")
    public List<Map<String, Object>> workspaces(HttpServletRequest request) {
        return sync.workspaces(account(request));
    }

    @PostMapping("/workspaces")
    public Map<String, Object> register(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return sync.register(account(request), body);
    }

    @GetMapping("/outbox")
    public Map<String, Object> outbox(@RequestParam String workspaceId, @RequestParam(defaultValue = "200") int limit, HttpServletRequest request) {
        return sync.outbox(account(request), workspaceId, limit);
    }

    @PostMapping("/outbox/ack")
    public Map<String, Object> ack(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return sync.acknowledge(account(request), text(body.get("workspaceId")), body.get("opIds"));
    }

    @PostMapping("/apply")
    public Map<String, Object> apply(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return sync.apply(account(request), text(body.get("workspaceId")), body.get("changes"));
    }

    @PostMapping("/seed")
    public Map<String, Object> seed(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return sync.seed(account(request), text(body.get("workspaceId")), body.get("listIds"));
    }

    @GetMapping("/source-lists")
    public List<Map<String, Object>> sourceLists(@RequestParam String workspaceId, HttpServletRequest request) {
        return sync.sourceLists(account(request), workspaceId);
    }

    @PostMapping("/source-task")
    public Map<String, Object> sourceTask(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        String actor = owners.actor(request);
        if (actor == null) throw ApiException.unauthenticated();
        return sync.sourceTask(account(request), actor, body);
    }

    @PostMapping("/share-source")
    public Map<String, Object> shareSource(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return sync.shareSource(account(request), text(body.get("workspaceId")), text(body.get("kind")), text(body.get("id")));
    }

    @GetMapping("/assigned")
    public List<Map<String, Object>> assigned(HttpServletRequest request) {
        String actor = owners.actor(request);
        if (actor == null) throw ApiException.unauthenticated();
        return sync.assignedToMe(account(request), actor);
    }
}
