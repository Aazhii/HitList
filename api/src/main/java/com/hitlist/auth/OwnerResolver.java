package com.hitlist.auth;

import com.hitlist.config.HitListProperties;
import com.hitlist.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;
import org.springframework.http.ResponseCookie;

@Component
public class OwnerResolver {
    public static final String OWNER_ATTRIBUTE = OwnerResolver.class.getName() + ".owner";
    /** The signed-in account's own workspace, even when the request is about a shared one. */
    public static final String PERSONAL_ATTRIBUTE = OwnerResolver.class.getName() + ".personal";
    /** The signed-in account's Catalyst user id (desktop only), when the shell named it and it matches the account. */
    public static final String ACTOR_ATTRIBUTE = OwnerResolver.class.getName() + ".actor";
    public static final String COOKIE_NAME = "hitlist_owner_v1";
    private static final String COOKIE_VERSION = "v1";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int OWNER_BYTES = 32;
    private final byte[] signingSecret;
    private final boolean catalystMode;
    private final boolean desktopMode;
    private final byte[] desktopToken;

    public OwnerResolver(HitListProperties properties) {
        catalystMode = "catalyst".equalsIgnoreCase(properties.getAuthMode());
        String token = properties.getDesktopToken() == null ? "" : properties.getDesktopToken();
        // Desktop mode needs a real secret; without one it behaves as plain cookie mode.
        desktopMode = "desktop".equalsIgnoreCase(properties.getAuthMode()) && token.length() >= 32;
        desktopToken = token.getBytes(StandardCharsets.UTF_8);
        String configuredSecret = properties.getOwnerCookieSecret();
        signingSecret = configuredSecret == null || configuredSecret.isBlank()
            ? randomBytes(OWNER_BYTES)
            : configuredSecret.getBytes(StandardCharsets.UTF_8);
        if (configuredSecret != null && !configuredSecret.isBlank() && signingSecret.length < OWNER_BYTES) {
            throw new IllegalArgumentException("OWNER_COOKIE_SECRET must be at least 32 bytes");
        }
    }

    /** True when Catalyst's own sign-in decides who a request is from, rather than a browser cookie. */
    public boolean isCatalystMode() {
        return catalystMode;
    }

    /** True in the desktop build, where the Electron shell may name the signed-in account on a request. */
    public boolean isDesktopMode() {
        return desktopMode;
    }

    /**
     * The account the Electron shell attached to this request, as an owner id, or null. Both headers must be there:
     * the per-launch secret (compared in constant time) and a 43-character owner id. Anything else, including a
     * wrong secret, is treated as no account at all, so the request falls back to the browser cookie workspace.
     */
    public String desktopOwner(HttpServletRequest request) {
        if (!desktopMode) {
            return null;
        }
        String token = request.getHeader("X-Hitlist-Desktop-Token");
        String owner = request.getHeader("X-Hitlist-Desktop-Owner");
        if (token == null || owner == null || !isOwnerId(owner)) {
            return null;
        }
        return MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), desktopToken) ? owner : null;
    }

    /**
     * The signed-in Catalyst user, or null. Catalyst's gateway sets x-zc-user-id on every request to the AppSail and
     * replaces any value a client sends (checked against the deployed gateway). Before sign-in it carries the
     * project's own id, which is not a person, so that is refused. x-zc-user-type is NOT used: the gateway passes
     * a client-supplied one through.
     */
    public String catalystUserId(HttpServletRequest request) {
        String id = request.getHeader("x-zc-user-id");
        String project = request.getHeader("x-zc-projectid");
        if (id == null || !id.matches("[0-9]{5,30}") || id.equals(project)) {
            return null;
        }
        return id;
    }

    /** A stable 43-character owner id for a Catalyst user, so it fits the same storage as a cookie owner. */
    public String catalystOwner(String userId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(("catalyst:" + userId).getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    /** The browser's old cookie workspace, if it carries a valid one. Never issues a new cookie. */
    public String legacyCookieOwner(HttpServletRequest request) {
        return cookieValue(request);
    }

    /** The account's own workspace (never a shared one). */
    public String personalOwner(HttpServletRequest request) {
        Object owner = request.getAttribute(PERSONAL_ATTRIBUTE);
        if (owner instanceof String value && isOwnerId(value)) {
            return value;
        }
        return owner(request);
    }

    /** The signed-in Catalyst user id on the desktop, or null. */
    public String actor(HttpServletRequest request) {
        Object actor = request.getAttribute(ACTOR_ATTRIBUTE);
        return actor instanceof String value ? value : null;
    }

    public String owner(HttpServletRequest request) {
        Object owner = request.getAttribute(OWNER_ATTRIBUTE);
        if (owner instanceof String value && isOwnerId(value)) {
            return value;
        }
        throw ApiException.unauthenticated();
    }

    public String resolveOrIssue(HttpServletRequest request, HttpServletResponse response) {
        String owner = cookieValue(request);
        if (owner != null) {
            return owner;
        }
        String issued = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes(OWNER_BYTES));
        response.addHeader("Set-Cookie", cookie(issued, request));
        return issued;
    }

    private String cookieValue(HttpServletRequest request) {
        if (request.getCookies() == null) {
            return null;
        }
        for (var cookie : request.getCookies()) {
            if (!COOKIE_NAME.equals(cookie.getName())) {
                continue;
            }
            String owner = verifiedOwner(cookie.getValue());
            if (owner != null) {
                return owner;
            }
        }
        return null;
    }

    private String verifiedOwner(String value) {
        if (value == null) {
            return null;
        }
        String[] parts = value.split("\\.", -1);
        if (parts.length != 3 || !COOKIE_VERSION.equals(parts[0]) || !isOwnerId(parts[1])) {
            return null;
        }
        try {
            byte[] supplied = Base64.getUrlDecoder().decode(parts[2]);
            byte[] expected = hmac(COOKIE_VERSION + "." + parts[1]);
            return MessageDigest.isEqual(expected, supplied) ? parts[1] : null;
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private String cookie(String owner, HttpServletRequest request) {
        String signature = Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(COOKIE_VERSION + "." + owner));
        return ResponseCookie.from(COOKIE_NAME, COOKIE_VERSION + "." + owner + "." + signature)
            .httpOnly(true)
            .secure(request.isSecure())
            .sameSite("Lax")
            .path("/")
            .maxAge(Duration.ofDays(365))
            .build()
            .toString();
    }

    private byte[] hmac(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingSecret, "HmacSHA256"));
            return mac.doFinal(value.getBytes(StandardCharsets.US_ASCII));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", exception);
        }
    }

    private boolean isOwnerId(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{43}");
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }
}
