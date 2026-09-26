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
    public static final String COOKIE_NAME = "hitlist_owner_v1";
    private static final String COOKIE_VERSION = "v1";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int OWNER_BYTES = 32;
    private final byte[] signingSecret;

    public OwnerResolver(HitListProperties properties) {
        String configuredSecret = properties.getOwnerCookieSecret();
        signingSecret = configuredSecret == null || configuredSecret.isBlank()
            ? randomBytes(OWNER_BYTES)
            : configuredSecret.getBytes(StandardCharsets.UTF_8);
        if (configuredSecret != null && !configuredSecret.isBlank() && signingSecret.length < OWNER_BYTES) {
            throw new IllegalArgumentException("OWNER_COOKIE_SECRET must be at least 32 bytes");
        }
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
