package com.hitlist.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "hitlist")
public class HitListProperties {
    private String allowedOrigins = "";
    private String ownerCookieSecret = "";
    /** "cookie" (default): a signed browser cookie owns the workspace. "catalyst": Catalyst's sign-in does. */
    private String authMode = "cookie";
    private boolean debugHeaders;
    /** Desktop build only: a per-launch secret the Electron shell sends with the signed-in account. Empty elsewhere. */
    private String desktopToken = "";

    public String getDesktopToken() {
        return desktopToken;
    }

    public void setDesktopToken(String desktopToken) {
        this.desktopToken = desktopToken;
    }

    public String getAuthMode() {
        return authMode;
    }

    public void setAuthMode(String authMode) {
        this.authMode = authMode;
    }

    public boolean isDebugHeaders() {
        return debugHeaders;
    }

    public void setDebugHeaders(boolean debugHeaders) {
        this.debugHeaders = debugHeaders;
    }

    public String getAllowedOrigins() {
        return allowedOrigins;
    }

    public void setAllowedOrigins(String allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    public String getOwnerCookieSecret() {
        return ownerCookieSecret;
    }

    public void setOwnerCookieSecret(String ownerCookieSecret) {
        this.ownerCookieSecret = ownerCookieSecret;
    }
}
