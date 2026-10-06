package com.hitlist.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import com.hitlist.domain.SyncService;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class OwnerSessionFilter extends OncePerRequestFilter {
    private final OwnerResolver owners;
    private final SyncService sync;

    /** Without shared workspaces (tools and tests that build the filter by hand). */
    public OwnerSessionFilter(OwnerResolver owners) {
        this(owners, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public OwnerSessionFilter(OwnerResolver owners, SyncService sync) {
        this.owners = owners;
        this.sync = sync;
    }

    /** Shared task and source editors use the selected partition; account services remain personal. */
    private static boolean sharable(String uri) {
        return uri.startsWith("/api/tasks") || uri.startsWith("/api/lists") || uri.startsWith("/api/stats")
            || uri.startsWith("/api/notes") || uri.startsWith("/api/databases") || uri.startsWith("/api/fields")
            || uri.startsWith("/api/field-values") || uri.startsWith("/api/views") || uri.equals("/api/calendar");
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    /** What a signed-out browser may still ask: whether it is signed in, and whether the service is up. */
    private static boolean isOpen(String uri) {
        return uri.equals("/api/session") || uri.equals("/api/health");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        if (owners.isCatalystMode()) {
            String userId = owners.catalystUserId(request);
            if (userId != null) {
                request.setAttribute(OwnerResolver.OWNER_ATTRIBUTE, owners.catalystOwner(userId));
            } else if (!isOpen(request.getRequestURI())) {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"unauthenticated\",\"message\":\"Sign in to continue\",\"loginUrl\":\"/__catalyst/auth/login\"}");
                return;
            }
            chain.doFilter(request, response);
            return;
        }
        String account = owners.desktopOwner(request);
        String personal = account != null ? account : owners.resolveOrIssue(request, response);
        request.setAttribute(OwnerResolver.OWNER_ATTRIBUTE, personal);
        request.setAttribute(OwnerResolver.PERSONAL_ATTRIBUTE, personal);
        if (account != null) {
            String actor = request.getHeader("X-Hitlist-Desktop-User");
            if (actor != null && actor.matches("[0-9]{5,30}") && account.equals(owners.catalystOwner(actor))) {
                request.setAttribute(OwnerResolver.ACTOR_ATTRIBUTE, actor);
            }
            // A shared workspace, picked in the app. Only for a signed-in account that belongs to it on this device; a
            // member who was removed keeps a read-only copy.
            String workspace = request.getHeader("X-Hitlist-Workspace");
            if (workspace != null && !workspace.isBlank() && sharable(request.getRequestURI())) {
                boolean write = !"GET".equalsIgnoreCase(request.getMethod());
                if (sync == null || !sync.canUse(account, workspace, write)) {
                    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                    response.setContentType("application/json");
                    response.getWriter().write("{\"error\":\"forbidden\",\"message\":\"You do not have access to this workspace\"}");
                    return;
                }
                request.setAttribute(OwnerResolver.OWNER_ATTRIBUTE, workspace);
            }
        }
        chain.doFilter(request, response);
    }
}
