package com.hitlist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.auth.OwnerResolver;
import com.hitlist.auth.OwnerSessionFilter;
import com.hitlist.config.HitListProperties;
import com.hitlist.domain.CliqCommandService;
import com.hitlist.domain.EntityRepository;
import com.hitlist.domain.TaskService;
import com.hitlist.storage.JdbcRowStore;
import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import com.hitlist.web.ApiExceptionHandler;
import com.hitlist.web.CliqCommandController;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockCookie;
import org.springframework.transaction.interceptor.TransactionProxyFactoryBean;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class CliqCommandTest {
    private static final String ACCOUNT = "123456789";
    private static final String DEVICE = "desktop-1";
    private static final String TOKEN = "a-per-launch-desktop-secret-at-least-32-bytes";
    @TempDir Path folder;

    @Test
    void createReplaysAndRejectsChangedPayloadAndIdentity() {
        Fixture fixture = fixture(false);
        Map<String, Object> command = command("create-1", "create", Map.of("title", "Hello", "dueDate", "2030-01-02"));
        Map<String, Object> first = fixture.commands.execute(fixture.owner, command, identity());
        assertThat(first.get("status")).isEqualTo("applied");
        assertThat(fixture.commands.execute(fixture.owner, new LinkedHashMap<>(command), identity())).isEqualTo(first);
        assertThat(fixture.repository.list(StorageTables.TASKS, fixture.owner)).hasSize(1);
        Map<String, Object> changed = new LinkedHashMap<>(command);
        changed.put("payload", Map.of("title", "Different"));
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner, changed, identity())).isInstanceOf(ApiException.class)
            .hasMessageContaining("different content");
        Map<String, Object> differentDevice = new LinkedHashMap<>(command);
        differentDevice.put("deviceId", "desktop-2");
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner, differentDevice, identity())).isInstanceOf(ApiException.class);
        assertThat(first.toString()).doesNotContain("note");
        Map<String, Object> nextGeneration = new LinkedHashMap<>(command);
        nextGeneration.put("generation", 2);
        Map<String, Object> nextIdentity = Map.of("accountId", ACCOUNT, "deviceId", DEVICE, "generation", 2L, "timeZone", "UTC");
        Map<String, Object> second = fixture.commands.execute(fixture.owner, nextGeneration, nextIdentity);
        assertThat(((Map<?, ?>) second.get("task")).get("taskId")).isNotEqualTo(((Map<?, ?>) first.get("task")).get("taskId"));
        assertThat(fixture.repository.list(StorageTables.TASKS, fixture.owner)).hasSize(2);
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner,
            command("unsafe", "create", Map.of("title", "Hidden", "note", "injected")), identity()))
            .isInstanceOf(ApiException.class).hasMessageContaining("Unsupported payload field");
    }

    @Test
    void receiptFailureRollsBackTaskUsingRealSqliteTransactionProxy() {
        Fixture fixture = fixture(true);
        Map<String, Object> command = command("failure-1", "create", Map.of("title", "Must roll back"));
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner, command, identity()))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("receipt write failed");
        assertThat(fixture.repository.list(StorageTables.TASKS, fixture.owner)).isEmpty();
        assertThat(fixture.repository.list(StorageTables.CLIQ_COMMAND_RECEIPTS, fixture.owner)).isEmpty();
        Map<String, Object> result = fixture.commands.execute(fixture.owner, command, identity());
        assertThat(((Map<?, ?>) result.get("task")).get("taskId")).isEqualTo(
            UUID.nameUUIDFromBytes((fixture.owner + ":" + DEVICE + ":1:failure-1").getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString());
        assertThat(fixture.repository.list(StorageTables.TASKS, fixture.owner)).hasSize(1);
    }

    @Test
    void editChecksTimestampAndCompletionCreatesOneNextOccurrence() {
        Fixture fixture = fixture(false);
        Map<String, Object> original = fixture.tasks.create(fixture.owner,
            Map.of("clientId", "recurring", "title", "Repeat", "recurrence", "WEEKLY", "dueDate", "2030-01-02"));
        String timestamp = (String) original.get("updatedAt");
        Map<String, Object> edit = command("edit-1", "edit", Map.of(
            "taskId", "recurring", "expectedUpdatedAt", timestamp, "title", "Changed"));
        Map<String, Object> edited = fixture.commands.execute(fixture.owner, edit, identity());
        assertThat(edited.get("status")).isEqualTo("applied");
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner,
            command("edit-2", "edit", Map.of("taskId", "recurring", "expectedUpdatedAt", timestamp, "title", "Stale")), identity()))
            .isInstanceOf(ApiException.class).hasMessageContaining("changed");
        String current = (String) ((Map<?, ?>) edited.get("task")).get("updatedAt");
        Map<String, Object> complete = command("complete-1", "complete", Map.of("taskId", "recurring", "expectedUpdatedAt", current));
        Map<String, Object> result = fixture.commands.execute(fixture.owner, complete, identity());
        assertThat(fixture.commands.execute(fixture.owner, complete, identity())).isEqualTo(result);
        assertThat(fixture.repository.list(StorageTables.TASKS, fixture.owner)).hasSize(2);
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner,
            command("complete-2", "complete", Map.of("taskId", "recurring", "expectedUpdatedAt", current)), identity()))
            .isInstanceOf(ApiException.class).hasMessageContaining("changed");
        assertThat(fixture.repository.list(StorageTables.TASKS, fixture.owner)).hasSize(2);
    }

    @Test
    void expiredAndListResultsAreBoundedAndDoNotIncludeNotes() {
        Fixture fixture = fixture(false);
        for (int index = 0; index < 12; index++) fixture.tasks.create(fixture.owner,
            Map.of("title", "Task " + index, "note", "private body", "dueDate", "2030-01-02"));
        Map<String, Object> expired = command("expired", "create", Map.of("title", "Too late"));
        expired.put("expiresAt", Instant.parse("2020-01-01T00:00:00Z").toEpochMilli());
        assertThat(fixture.commands.execute(fixture.owner, expired, identity()).get("status")).isEqualTo("expired");
        assertThat(fixture.commands.execute(fixture.owner, expired, identity()).get("status")).isEqualTo("expired");
        Map<String, Object> isoExpiry = command("iso-expiry", "create", Map.of("title", "Invalid"));
        isoExpiry.put("expiresAt", "2030-01-01T00:00:00Z");
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner, isoExpiry, identity()))
            .isInstanceOf(ApiException.class).hasMessageContaining("expiresAt must be a positive integer");
        Map<String, Object> listed = fixture.commands.execute(fixture.owner,
            command("list-1", "list", Map.of("filter", "open", "page", 1)), identity());
        assertThat((List<?>) listed.get("tasks")).hasSize(10);
        assertThat(listed.toString()).doesNotContain("private body", "note");
        assertThat(listed.get("hasMore")).isEqualTo(true);
        assertThatThrownBy(() -> fixture.commands.execute(fixture.owner,
            command("list-2", "list", Map.of("filter", "today")), Map.of("accountId", ACCOUNT, "deviceId", DEVICE, "generation", 1L, "timeZone", "not/a-zone")))
            .isInstanceOf(ApiException.class).hasMessageContaining("timeZone");
    }

    @Test
    void overdueUsesDueTimeInIdentityTimeZone() {
        Fixture fixture = fixture(false);
        ZoneOffset zone = ZoneOffset.ofHours(12 - Instant.now().atZone(ZoneOffset.UTC).getHour());
        Map<String, Object> zonedIdentity = Map.of("accountId", ACCOUNT, "deviceId", DEVICE, "generation", 1L, "timeZone", zone.getId());
        var localNow = Instant.now().atZone(zone);
        String today = localNow.toLocalDate().toString();
        String pastTime = localNow.minusHours(1).format(DateTimeFormatter.ofPattern("HH:mm"));
        String futureTime = localNow.plusHours(1).format(DateTimeFormatter.ofPattern("HH:mm"));
        fixture.tasks.create(fixture.owner, Map.of("clientId", "past-today", "title", "Past today", "dueDate", today, "dueTime", pastTime));
        fixture.tasks.create(fixture.owner, Map.of("clientId", "future-today", "title", "Future today", "dueDate", today, "dueTime", futureTime));
        fixture.tasks.create(fixture.owner, Map.of("clientId", "untimed-today", "title", "Untimed today", "dueDate", today));
        fixture.tasks.create(fixture.owner, Map.of("clientId", "yesterday", "title", "Yesterday", "dueDate", localNow.toLocalDate().minusDays(1).toString()));
        fixture.tasks.create(fixture.owner, Map.of("clientId", "tomorrow", "title", "Tomorrow", "dueDate", localNow.toLocalDate().plusDays(1).toString()));
        fixture.tasks.create(fixture.owner, Map.of("clientId", "undated", "title", "Undated"));

        Map<String, Object> result = fixture.commands.execute(fixture.owner,
            command("overdue-1", "list", Map.of("filter", "overdue")), zonedIdentity);
        assertThat(((List<?>) result.get("tasks")).stream().map(task -> String.valueOf(((Map<?, ?>) task).get("taskId"))).toList())
            .containsExactlyInAnyOrder("past-today", "yesterday");
    }

    @Test
    @SuppressWarnings("null")
    void controllerRejectsCookieFallbackAndWrongAccount() throws Exception {
        Fixture fixture = fixture(false);
        HitListProperties properties = new HitListProperties();
        properties.setAuthMode("desktop");
        properties.setDesktopToken(TOKEN);
        OwnerResolver owners = new OwnerResolver(properties);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new CliqCommandController(owners, fixture.commands))
            .addFilters(new OwnerSessionFilter(owners))
            .setControllerAdvice(new ApiExceptionHandler()).build();
        String body = new ObjectMapper().writeValueAsString(command("http-1", "create", Map.of("title", "HTTP")));
        String cookieOwner = fixture.owner;
        mvc.perform(post("/api/cliq/commands").cookie(new MockCookie(OwnerResolver.COOKIE_NAME, cookieOwner))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/cliq/commands").header("X-Hitlist-Desktop-Token", "wrong")
                .header("X-Hitlist-Desktop-Owner", owners.catalystOwner(ACCOUNT))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/cliq/commands").header("X-Hitlist-Desktop-Token", TOKEN)
                .header("X-Hitlist-Desktop-Owner", owners.catalystOwner("987654321"))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/cliq/commands").header("X-Hitlist-Desktop-Token", TOKEN)
                .header("X-Hitlist-Desktop-Owner", owners.catalystOwner(ACCOUNT))
                .contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("applied"))
            .andExpect(jsonPath("$.task.title").value("HTTP"));
        Map<String, Object> malformed = command("http-bad", "create", Map.of("title", "Never"));
        malformed.put("deviceId", null);
        mvc.perform(post("/api/cliq/commands").header("X-Hitlist-Desktop-Token", TOKEN)
                .header("X-Hitlist-Desktop-Owner", owners.catalystOwner(ACCOUNT))
                .contentType(MediaType.APPLICATION_JSON).content(new ObjectMapper().writeValueAsString(malformed)))
            .andExpect(status().isBadRequest());
    }

    private Fixture fixture(boolean failReceiptUpdate) {
        DriverManagerDataSource source = new DriverManagerDataSource("jdbc:sqlite:" + folder.resolve(UUID.randomUUID() + ".db"));
        RowStore storage = new JdbcRowStore(source, new ObjectMapper(), "sqlite");
        if (failReceiptUpdate) storage = new FailingReceiptStore(storage);
        EntityRepository repository = new EntityRepository(storage);
        TaskService tasks = new TaskService(repository);
        CliqCommandService target = new CliqCommandService(repository, tasks, new ObjectMapper());
        TransactionProxyFactoryBean factory = new TransactionProxyFactoryBean();
        factory.setTarget(target);
        factory.setProxyTargetClass(true);
        factory.setTransactionManager(new DataSourceTransactionManager(source));
        Properties attributes = new Properties();
        attributes.setProperty("execute", "PROPAGATION_REQUIRED");
        factory.setTransactionAttributes(attributes);
        factory.afterPropertiesSet();
        return new Fixture(repository, tasks, (CliqCommandService) factory.getObject(), "owner-1");
    }

    private Map<String, Object> identity() {
        return Map.of("accountId", ACCOUNT, "deviceId", DEVICE, "generation", 1L, "timeZone", "UTC");
    }

    private Map<String, Object> command(String id, String type, Map<String, Object> payload) {
        Map<String, Object> command = new LinkedHashMap<>();
        command.put("id", id);
        command.put("accountId", ACCOUNT);
        command.put("deviceId", DEVICE);
        command.put("generation", 1);
        command.put("schemaVersion", 1);
        command.put("type", type);
        command.put("payload", payload);
        command.put("expiresAt", Instant.now().plusSeconds(3600).toEpochMilli());
        return command;
    }

    private record Fixture(EntityRepository repository, TaskService tasks, CliqCommandService commands, String owner) { }

    private record FailingReceiptStore(RowStore delegate, AtomicBoolean failNextUpdate) implements RowStore {
        private FailingReceiptStore(RowStore delegate) { this(delegate, new AtomicBoolean(true)); }
        public List<Map<String, Object>> findByOwner(String table, String owner) { return delegate.findByOwner(table, owner); }
        public Map<String, Object> insert(String table, Map<String, Object> row) { return delegate.insert(table, row); }
        public Map<String, Object> update(String table, String rowId, Map<String, Object> row) {
            if (StorageTables.CLIQ_COMMAND_RECEIPTS.equals(table) && failNextUpdate.compareAndSet(true, false)) {
                throw new IllegalStateException("receipt write failed");
            }
            return delegate.update(table, rowId, row);
        }
        public void delete(String table, String rowId) { delegate.delete(table, rowId); }
        public String mode() { return delegate.mode(); }
    }
}