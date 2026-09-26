package com.hitlist.web;

import com.hitlist.config.HitListProperties;
import com.hitlist.config.WebConfiguration;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpMethod;
import org.springframework.web.filter.OncePerRequestFilter;

public class SimpleRequestFilter extends OncePerRequestFilter {
    private static final Set<String> OVERRIDABLE = Set.of("PUT", "PATCH", "DELETE");
    private final Set<String> allowedOrigins;

    public SimpleRequestFilter(HitListProperties properties) {
        allowedOrigins = Set.copyOf(Arrays.asList(WebConfiguration.configuredOrigins(properties)));
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        String method = requestedMethod(request);
        String origin = request.getHeader("Origin");
        if (origin != null && !isReadOnly(method) && !isAllowedOrSameHost(origin, request)) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"forbidden_origin\",\"message\":\"This origin may not change data\"}");
            return;
        }
        chain.doFilter(new MethodOverrideRequest(request, method), response);
    }

    private String requestedMethod(HttpServletRequest request) {
        String override = request.getParameter("_method");
        if ("POST".equalsIgnoreCase(request.getMethod()) && override != null) {
            String upper = override.toUpperCase(Locale.ROOT);
            if (OVERRIDABLE.contains(upper)) {
                return upper;
            }
        }
        return request.getMethod();
    }

    private boolean isReadOnly(String method) {
        return HttpMethod.GET.matches(method) || HttpMethod.HEAD.matches(method) || HttpMethod.OPTIONS.matches(method);
    }

    private boolean isAllowedOrSameHost(String origin, HttpServletRequest request) {
        if (allowedOrigins.contains(origin)) {
            return true;
        }
        try {
            String forwardedHost = request.getHeader("X-Forwarded-Host");
            String host = forwardedHost == null || forwardedHost.isBlank() ? request.getHeader("Host") : forwardedHost.split(",")[0].trim();
            return host != null && URI.create(origin).getAuthority().replaceFirst("\\.$", "").equalsIgnoreCase(host.replaceFirst("\\.$", ""));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static final class MethodOverrideRequest extends HttpServletRequestWrapper {
        private final String method;

        private MethodOverrideRequest(HttpServletRequest request, String method) {
            super(request);
            this.method = method;
        }

        @Override
        public String getMethod() {
            return method;
        }
    }
}
