package com.hitlist.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Temporary, for finding out what identity Catalyst's gateway puts on a request to the AppSail once sign-in is
 * on. Off unless HITLIST_DEBUG_HEADERS=true. Values are cut to their first characters and a length, so a pasted
 * result never carries a usable token.
 */
@RestController
@RequestMapping("/api/_debug")
@ConditionalOnProperty(name = "hitlist.debug-headers", havingValue = "true")
public class DebugHeadersController {
    @GetMapping("/headers")
    Map<String, Object> headers(HttpServletRequest request) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String name : Collections.list(request.getHeaderNames())) {
            out.put(name, redact(request.getHeader(name)));
        }
        Map<String, Object> cookies = new LinkedHashMap<>();
        if (request.getCookies() != null) {
            for (var cookie : request.getCookies()) cookies.put(cookie.getName(), redact(cookie.getValue()));
        }
        return Map.of("headers", out, "cookies", cookies, "remoteAddr", request.getRemoteAddr(),
            "scheme", request.getScheme(), "serverName", request.getServerName());
    }

    private static String redact(String value) {
        if (value == null) return "";
        return value.length() <= 8 ? value : value.substring(0, 6) + "…(" + value.length() + " chars)";
    }
}
