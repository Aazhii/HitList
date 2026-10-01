package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.WorkspaceClaimService;
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
    private final WorkspaceClaimService claims;

    public SessionController(OwnerResolver owners, WorkspaceClaimService claims) {
        this.owners = owners;
        this.claims = claims;
    }

    @GetMapping
    Map<String, Object> session(HttpServletRequest request) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (owners.isDesktopMode()) {
            // The app always opens; signing in only decides whose workspace it is. The first time an account is
            // named from a browser that still holds an old cookie workspace, that workspace is brought across.
            String account = owners.desktopOwner(request);
            out.put("mode", "desktop");
            out.put("authenticated", account != null);
            if (account != null) {
                Map<String, Integer> moved = claims.claim(owners.legacyCookieOwner(request), account);
                if (!moved.isEmpty()) out.put("claimed", moved);
            }
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
        if (userId != null) {
            String owner = owners.catalystOwner(userId);
            // First sign-in from a browser that still holds an old cookie workspace: bring it across.
            Map<String, Integer> moved = claims.claim(owners.legacyCookieOwner(request), owner);
            if (!moved.isEmpty()) out.put("claimed", moved);
        }
        return out;
    }
}
