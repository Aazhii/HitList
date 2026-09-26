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

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        request.setAttribute(OwnerResolver.OWNER_ATTRIBUTE, owners.resolveOrIssue(request, response));
        chain.doFilter(request, response);
    }
}
