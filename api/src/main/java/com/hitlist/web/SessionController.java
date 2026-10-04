package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Whether the caller is signed in, for the client to decide between the app and Catalyst's login page. */
@RestController
@RequestMapping("/api/session")
public class SessionController {
    private final OwnerResolver owners;
    public SessionController(OwnerResolver owners) {
        this.owners = owners;
    }

    @GetMapping
    Map<String, Object> session(HttpServletRequest request) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (owners.isDesktopMode()) {
            String account = owners.desktopOwner(request);
            out.put("mode", "desktop");
            out.put("authenticated", account != null);
            if (account != null) out.put("userId", account);
            return out;
        }
        if (!owners.isCatalystMode()) {
            out.put("mode", "cookie");
            out.put("authenticated", true);
            return out;
        }
        out.put("mode", "catalyst");
        out.put("loginUrl", "/__catalyst/auth/login");
        String userId = owners.catalystUserId(request);
        out.put("authenticated", userId != null);
        if (userId != null) out.put("userId", userId);
        return out;
    }
}
