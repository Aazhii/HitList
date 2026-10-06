package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.CliqCommandService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cliq/commands")
public class CliqCommandController {
    private final OwnerResolver owners;
    private final CliqCommandService commands;

    public CliqCommandController(OwnerResolver owners, CliqCommandService commands) {
        this.owners = owners;
        this.commands = commands;
    }

    @PostMapping
    public Map<String, Object> execute(@RequestBody Map<String, Object> command, HttpServletRequest request) {
        String owner = owners.desktopOwner(request);
        if (owner == null) throw ApiException.unauthenticated();
        Object account = command.get("accountId");
        if (!(account instanceof String accountId) || !accountId.matches("[0-9]{5,30}")
            || !owner.equals(owners.catalystOwner(accountId))) throw ApiException.unauthenticated();
        Map<String, Object> identity = new LinkedHashMap<>();
        identity.put("accountId", accountId);
        identity.put("deviceId", command.get("deviceId"));
        identity.put("generation", command.get("generation"));
        identity.put("timeZone", request.getHeader("X-Timezone"));
        return commands.execute(owner, command, identity);
    }
}