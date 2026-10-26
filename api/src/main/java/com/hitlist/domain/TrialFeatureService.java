package com.hitlist.domain;

import com.hitlist.storage.StorageTables;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

/**
 * The switches for optional features, for a whole installation rather than a person.
 *
 * Shared workspaces are off by default: every workspace request costs the hosted project several Catalyst Data Store
 * fetches, and the desktop's fallback polling kept spending them while nobody was using the feature. With the flag off
 * the app never asks the cloud about workspaces at all, so the cost is zero rather than small.
 *
 * Where a flag's value comes from, first answer wins:
 *   1. the environment (HITLIST_FEATURE_SHAREDWORKSPACES=true), for a deployment that wants it on without touching data;
 *   2. a row in KaizenTrialFeatures ({ FeatureKey, Enabled }), under the empty owner, for a stored decision;
 *   3. the built-in default below.
 * Nothing here is writable over HTTP: a flag covers everyone on the installation, so one person must not be able to flip
 * it for the rest.
 */
@Service
public class TrialFeatureService {
    public static final String NOTIFICATIONS = "notifications";
    public static final String AUTOMATIONS = "automations";
    public static final String SHARED_WORKSPACES = "sharedWorkspaces";

    /** Flags are a property of the installation, so they are stored under no owner. */
    static final String INSTALLATION = "";

    private static final Map<String, Boolean> DEFAULTS = Map.of(
        NOTIFICATIONS, true,
        AUTOMATIONS, true,
        SHARED_WORKSPACES, false
    );

    private final EntityRepository repository;
    private final Environment environment;

    public TrialFeatureService(EntityRepository repository, Environment environment) {
        this.repository = repository;
        this.environment = environment;
    }

    /** Every flag with the value this installation uses, in a fixed order. */
    public Map<String, Object> flags() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String key : new String[] { NOTIFICATIONS, AUTOMATIONS, SHARED_WORKSPACES }) {
            out.put(key, enabled(key));
        }
        return out;
    }

    public boolean enabled(String key) {
        Boolean fromEnvironment = environmentValue(key);
        if (fromEnvironment != null) {
            return fromEnvironment;
        }
        return repository.find(StorageTables.TRIAL_FEATURES, INSTALLATION, key)
            .map(row -> Values.bool(row.get("Enabled")))
            .orElseGet(() -> DEFAULTS.getOrDefault(key, false));
    }

    /** Writes the stored decision. For tools and tests: there is no HTTP route to this. */
    public void set(String key, boolean value) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("FeatureKey", key);
        row.put("Enabled", value);
        if (repository.find(StorageTables.TRIAL_FEATURES, INSTALLATION, key).isPresent()) {
            repository.replace(StorageTables.TRIAL_FEATURES, INSTALLATION, key, row);
        } else {
            repository.insert(StorageTables.TRIAL_FEATURES, INSTALLATION, row);
        }
    }

    /** HITLIST_FEATURE_SHAREDWORKSPACES, and the same shape for the others; anything but true/false is ignored. */
    private Boolean environmentValue(String key) {
        String raw = environment.getProperty("HITLIST_FEATURE_" + key.toUpperCase(java.util.Locale.ROOT), "").trim();
        if (raw.equalsIgnoreCase("true")) {
            return Boolean.TRUE;
        }
        return raw.equalsIgnoreCase("false") ? Boolean.FALSE : null;
    }
}
