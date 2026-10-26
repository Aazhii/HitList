package com.hitlist;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.domain.EntityRepository;
import com.hitlist.domain.TrialFeatureService;
import com.hitlist.storage.JdbcRowStore;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.env.MockEnvironment;
import static org.assertj.core.api.Assertions.assertThat;

class TrialFeatureServiceTest {
    @TempDir Path temp;

    private TrialFeatureService service(MockEnvironment environment) {
        var source = new DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("features.db"));
        return new TrialFeatureService(new EntityRepository(new JdbcRowStore(source, new ObjectMapper(), "sqlite")), environment);
    }

    @Test
    void sharedWorkspacesAreOffUntilTheInstallationTurnsThemOn() {
        var features = service(new MockEnvironment());

        // Nothing stored: notifications and automations are on, shared workspaces are not. Being off is what keeps the
        // app from asking the cloud about workspaces at all.
        assertThat(features.flags()).containsExactly(
            org.assertj.core.api.Assertions.entry("notifications", true),
            org.assertj.core.api.Assertions.entry("automations", true),
            org.assertj.core.api.Assertions.entry("sharedWorkspaces", false));

        features.set(TrialFeatureService.SHARED_WORKSPACES, true);
        assertThat(features.enabled(TrialFeatureService.SHARED_WORKSPACES)).isTrue();

        // The stored answer is a decision, not a one-way door.
        features.set(TrialFeatureService.SHARED_WORKSPACES, false);
        assertThat(features.enabled(TrialFeatureService.SHARED_WORKSPACES)).isFalse();
    }

    @Test
    void theEnvironmentOverridesWhatIsStored() {
        var environment = new MockEnvironment();
        environment.setProperty("HITLIST_FEATURE_SHAREDWORKSPACES", "true");
        var features = service(environment);
        features.set(TrialFeatureService.SHARED_WORKSPACES, false);
        assertThat(features.enabled(TrialFeatureService.SHARED_WORKSPACES)).isTrue();

        environment.setProperty("HITLIST_FEATURE_SHAREDWORKSPACES", "nonsense");
        assertThat(features.enabled(TrialFeatureService.SHARED_WORKSPACES)).isFalse();
    }
}
