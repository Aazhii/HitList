package com.hitlist.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class OwnerSessionFilter extends OncePerRequestFilter {
    private final OwnerResolver owners;

    public OwnerSessionFilter(OwnerResolver owners) {
        this.owners = owners;
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
        request.setAttribute(OwnerResolver.OWNER_ATTRIBUTE, owners.resolveOrIssue(request, response));
        chain.doFilter(request, response);
    }
}
