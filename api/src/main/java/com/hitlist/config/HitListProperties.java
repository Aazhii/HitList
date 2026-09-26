package com.hitlist.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "hitlist")
public class HitListProperties {
    private String allowedOrigins = "";
    private String ownerCookieSecret = "";

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
