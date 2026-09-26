package com.hitlist.storage;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.web.ApiException;
import java.net.URI;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Which database, and which RowStore sits on top of it — the only two things
 * that differ between a hosted deployment and the desktop app. Everything
 * else (JdbcRowStore, and every domain service above it) is identical either
 * way; see JdbcRowStore's own note for why one class covers both.
 */
@Configuration
public class StorageConfiguration {
    private static final String DEFAULT_MODE = "postgres";

    /** STORAGE_MODE decides everything below; unset means postgres, unchanged from before this existed. */
    private static String mode(Environment environment) {
        String mode = environment.getProperty("STORAGE_MODE", DEFAULT_MODE).trim().toLowerCase();
        if (!mode.equals("postgres") && !mode.equals("sqlite")) {
            throw ApiException.unavailable("STORAGE_MODE must be postgres or sqlite, got: " + mode);
        }
        return mode;
    }

    @Bean
    DataSource dataSource(Environment environment) {
        return mode(environment).equals("sqlite") ? sqliteDataSource(environment) : postgresDataSource(environment);
    }

    private DataSource postgresDataSource(Environment environment) {
        String databaseUrl = environment.getProperty("DATABASE_URL", "").trim();
        if (databaseUrl.isBlank()) {
            throw ApiException.unavailable("Set DATABASE_URL for the PostgreSQL backend.");
        }
        URI uri = URI.create(databaseUrl);
        String scheme = uri.getScheme();
        if (!"postgres".equals(scheme) && !"postgresql".equals(scheme)) {
            throw ApiException.unavailable("DATABASE_URL must use the postgres scheme");
        }
        DriverManagerDataSource source = new DriverManagerDataSource();
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw ApiException.unavailable("DATABASE_URL must include a host");
        }
        source.setUrl("jdbc:postgresql://" + host + (uri.getPort() > 0 ? ":" + uri.getPort() : "") + uri.getRawPath()
            + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
        if (uri.getUserInfo() != null) {
            String[] credentials = uri.getUserInfo().split(":", 2);
            source.setUsername(credentials[0]);
            if (credentials.length == 2) {
                source.setPassword(credentials[1]);
            }
        }
        return source;
    }

    /**
     * A single local file, no server process — the desktop app's whole reason
     * for existing. SQLITE_PATH is wherever the caller wants the .db file
     * (Electron points this at its own per-user app-data folder).
     */
    private DataSource sqliteDataSource(Environment environment) {
        String path = environment.getProperty("SQLITE_PATH", "").trim();
        if (path.isBlank()) {
            throw ApiException.unavailable("Set SQLITE_PATH for the SQLite backend.");
        }
        DriverManagerDataSource source = new DriverManagerDataSource();
        source.setUrl("jdbc:sqlite:" + path);
        return source;
    }

    @Bean
    RowStore rowStore(DataSource dataSource, ObjectMapper objectMapper, Environment environment) {
        return new JdbcRowStore(dataSource, objectMapper, mode(environment));
    }
}
