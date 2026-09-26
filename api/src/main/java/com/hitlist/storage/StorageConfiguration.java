package com.hitlist.storage;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.web.ApiException;
import java.net.URI;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Configuration
public class StorageConfiguration {
    @Bean
    DataSource dataSource(Environment environment) {
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

    @Bean
    RowStore rowStore(DataSource dataSource, ObjectMapper objectMapper) {
        return new PostgresRowStore(dataSource, objectMapper);
    }
}
