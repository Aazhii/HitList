package com.hitlist;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.auth.OwnerResolver;
import com.hitlist.auth.OwnerSessionFilter;
import com.hitlist.config.HitListProperties;
import com.hitlist.domain.EntityRepository;
import com.hitlist.domain.ListService;
import com.hitlist.domain.SyncJournal;
import com.hitlist.domain.SyncService;
import com.hitlist.domain.TaskService;
import com.hitlist.storage.JdbcRowStore;
import com.hitlist.storage.RowStore;
import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiExceptionHandler;
import com.hitlist.web.ListController;
import com.hitlist.web.SyncController;
import com.hitlist.web.TaskController;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** A shared workspace on one device: its partition, the change journal, applying other members' changes, assignment. */
class SharedWorkspaceTest {
    private static final String SECRET = "desktop-launch-secret-0123456789abcdef";
    private static final String ALICE = "100001";
    private static final String BOB = "200002";
    private static final String WS = "W".repeat(43);
    private final ObjectMapper json = new ObjectMapper();
    @TempDir Path folder;
    private MockMvc mvc;
    private OwnerResolver owners;
    private RowStore store;
    private String alice;
    private String bob;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource source = new DriverManagerDataSource("jdbc:sqlite:" + folder.resolve(UUID.randomUUID() + ".db"));
        store = new JdbcRowStore(source, json, "sqlite");
        HitListProperties props = new HitListProperties();
        props.setOwnerCookieSecret("contract-test-owner-cookie-secret");
        props.setAuthMode("desktop");
        props.setDesktopToken(SECRET);
        owners = new OwnerResolver(props);
        SyncJournal journal = new SyncJournal(store, json);
        EntityRepository repository = new EntityRepository(store, journal);
        TaskService tasks = new TaskService(repository);
        SyncService sync = new SyncService(store, repository, journal, tasks, json);
        mvc = MockMvcBuilders.standaloneSetup(new TaskController(tasks, owners), new ListController(new ListService(repository), owners),
                new SyncController(owners, sync))
            .setControllerAdvice(new ApiExceptionHandler())
            .addFilters(new OwnerSessionFilter(owners, sync))
            .build();
        alice = owners.catalystOwner(ALICE);
        bob = owners.catalystOwner(BOB);
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder request, String user) {
        return request.header("X-Hitlist-Desktop-Token", SECRET).header("X-Hitlist-Desktop-Owner", owners.catalystOwner(user))
            .header("X-Hitlist-Desktop-User", user);
    }

    private MockHttpServletRequestBuilder inWorkspace(MockHttpServletRequestBuilder request, String user) {
        return as(request, user).header("X-Hitlist-Workspace", WS);
    }

    private ResultActions send(MockHttpServletRequestBuilder request, Object body) throws Exception {
        return mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)));
    }

    private void register(String user, String state) throws Exception {
        send(as(post("/api/sync/workspaces"), user), Map.of("workspaceId", WS, "name", "Team", "role", "member", "state", state,
            "members", List.of(Map.of("userId", ALICE, "email", "alice@x.com", "name", "Alice", "role", "owner"),
                Map.of("userId", BOB, "email", "bob@x.com", "name", "Bob", "role", "member"))))
            .andExpect(status().isOk());
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> outbox(String user) throws Exception {
        String body = mvc.perform(as(get("/api/sync/outbox").param("workspaceId", WS), user)).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return (List<Map<String, Object>>) json.readValue(body, Map.class).get("ops");
    }

    @Test
    void aWorkspaceIsOnlyReachableByAccountsThatJoinedItOnThisDevice() throws Exception {
        mvc.perform(inWorkspace(get("/api/tasks"), ALICE)).andExpect(status().isForbidden());
        register(ALICE, "active");
        mvc.perform(inWorkspace(get("/api/tasks"), ALICE)).andExpect(status().isOk());
        mvc.perform(inWorkspace(get("/api/tasks"), BOB)).andExpect(status().isForbidden());
        // Without the shell's secret there is no account, so no workspace either.
        mvc.perform(get("/api/sync/workspaces")).andExpect(status().isUnauthorized());
        mvc.perform(as(get("/api/sync/workspaces"), ALICE)).andExpect(jsonPath("$[0].name").value("Team"))
            .andExpect(jsonPath("$[0].members[1].name").value("Bob"));
    }

    @Test
    void changesInTheSharedWorkspaceAreJournaledAndPersonalOnesAreNot() throws Exception {
        register(ALICE, "active");
        send(as(post("/api/lists"), ALICE), Map.of("name", "Mine only")).andExpect(status().isCreated());
        String listId = json.readTree(send(inWorkspace(post("/api/lists"), ALICE), Map.of("name", "Shared", "clientId", "list-1"))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
        send(inWorkspace(post("/api/tasks"), ALICE), Map.of("title", "Write spec", "listId", listId, "clientId", "task-1",
            "sourceNoteId", "my-note")).andExpect(status().isCreated());
        send(inWorkspace(put("/api/tasks/task-1"), ALICE), Map.of("status", "DONE")).andExpect(status().isOk());

        List<Map<String, Object>> ops = outbox(ALICE);
        assertThat(ops).hasSize(3);
        assertThat(ops.get(0).toString()).contains("Shared").doesNotContain("Mine only");
        Map<?, ?> created = (Map<?, ?>) ((Map<?, ?>) ops.get(1).get("op")).get("fields");
        assertThat(created.get("Title")).isEqualTo("Write spec");
        assertThat(created.containsKey("SourceNoteId")).isFalse(); // a link to Alice's own note stays on her machine
        Map<?, ?> edit = (Map<?, ?>) ((Map<?, ?>) ops.get(2).get("op")).get("fields");
        assertThat(edit.containsKey("Status") && edit.containsKey("UpdatedAt") && !edit.containsKey("Title")).isTrue();

        send(as(post("/api/sync/outbox/ack"), ALICE), Map.of("workspaceId", WS, "opIds", List.of(ops.get(0).get("opId"), ops.get(1).get("opId"))))
            .andExpect(jsonPath("$.removed").value(2));
        assertThat(outbox(ALICE)).hasSize(1);
    }

    @Test
    void otherMembersChangesApplyInOrderOnceAndAreNotSentBack() throws Exception {
        register(BOB, "active");
        List<Map<String, Object>> changes = List.of(
            Map.of("seq", 1, "ops", List.of(Map.of("table", "lists", "id", "list-1", "fields", Map.of("Name", "Shared", "CreatedAt", 1, "UpdatedAt", 1)))),
            Map.of("seq", 2, "ops", List.of(Map.of("table", "tasks", "id", "task-1", "fields", Map.of("Title", "Write spec", "Status", "TODO",
                "Quadrant", "DO", "ListId", "list-1", "CreatedAt", 1, "UpdatedAt", 1, "OwnerId", "steal")))));
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", changes))
            .andExpect(jsonPath("$.cursor").value(2)).andExpect(jsonPath("$.applied").value(2));
        mvc.perform(inWorkspace(get("/api/tasks"), BOB)).andExpect(jsonPath("$[0].title").value("Write spec"));
        assertThat(outbox(BOB)).isEmpty();
        // The same changes again add nothing; a gap stops and reports it.
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", changes)).andExpect(jsonPath("$.applied").value(0));
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", List.of(Map.of("seq", 5, "ops", List.of()))))
            .andExpect(jsonPath("$.gap").value(true)).andExpect(jsonPath("$.cursor").value(2));
        assertThat(store.findByOwner(StorageTables.TASKS, WS).get(0).get("OwnerId")).isEqualTo(WS);
    }

    @Test
    void aChangeThisDeviceSentItselfAppliesWithoutBeingSentBack() throws Exception {
        register(BOB, "active");
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", List.of(
            Map.of("seq", 1, "own", true, "ops", List.of(Map.of("table", "lists", "id", "list-1",
                "fields", Map.of("Name", "Mine", "CreatedAt", 1, "UpdatedAt", 1)))))))
            .andExpect(jsonPath("$.cursor").value(1)).andExpect(jsonPath("$.applied").value(1));
        mvc.perform(inWorkspace(get("/api/lists"), BOB)).andExpect(jsonPath("$[0].name").value("Mine"));
        assertThat(outbox(BOB)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void acknowledgedSameFieldEditsConvergeToTheLaterCloudSequence(boolean ownLater) throws Exception {
        register(BOB, "active");
        send(inWorkspace(post("/api/lists"), BOB), Map.of("name", "Shared", "clientId", "list-1"))
            .andExpect(status().isCreated());
        send(inWorkspace(post("/api/tasks"), BOB), Map.of("title", "From B", "listId", "list-1", "clientId", "task-1"))
            .andExpect(status().isCreated());
        send(as(post("/api/sync/outbox/ack"), BOB), Map.of("workspaceId", WS,
            "opIds", outbox(BOB).stream().map(entry -> entry.get("opId")).toList())).andExpect(status().isOk());
        List<Map<String, Object>> changes = List.of(
            Map.of("seq", 1, "own", !ownLater, "ops", List.of(Map.of("table", "tasks", "id", "task-1",
                "fields", Map.of("Title", ownLater ? "From A" : "From B")))),
            Map.of("seq", 2, "own", ownLater, "ops", List.of(Map.of("table", "tasks", "id", "task-1",
                "fields", Map.of("Title", ownLater ? "From B" : "From A")))));
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", changes))
            .andExpect(jsonPath("$.cursor").value(2)).andExpect(jsonPath("$.applied").value(2));
        mvc.perform(inWorkspace(get("/api/tasks/task-1"), BOB))
            .andExpect(jsonPath("$.title").value(ownLater ? "From B" : "From A"));
        assertThat(outbox(BOB)).isEmpty();
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", changes))
            .andExpect(jsonPath("$.applied").value(0));
    }

    @Test
    void ownEchoPreservesANewerPendingFieldButAppliesOtherFields() throws Exception {
        register(BOB, "active");
        send(inWorkspace(post("/api/lists"), BOB), Map.of("name", "Shared", "clientId", "list-1"))
            .andExpect(status().isCreated());
        send(inWorkspace(post("/api/tasks"), BOB), Map.of("title", "Sent title", "listId", "list-1", "clientId", "task-1"))
            .andExpect(status().isCreated());
        send(as(post("/api/sync/outbox/ack"), BOB), Map.of("workspaceId", WS,
            "opIds", outbox(BOB).stream().map(entry -> entry.get("opId")).toList())).andExpect(status().isOk());
        send(inWorkspace(put("/api/tasks/task-1"), BOB), Map.of("title", "New pending title"))
            .andExpect(status().isOk());
        List<Map<String, Object>> pending = outbox(BOB);
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", List.of(
            Map.of("seq", 1, "ops", List.of(Map.of("table", "tasks", "id", "task-1",
                "fields", Map.of("Title", "Remote title", "Status", "DONE")))),
            Map.of("seq", 2, "own", true, "ops", List.of(Map.of("table", "tasks", "id", "task-1",
                "fields", Map.of("Title", "Sent title", "Status", "TODO", "Quadrant", "SCHEDULE")))))))
            .andExpect(jsonPath("$.cursor").value(2));
        mvc.perform(inWorkspace(get("/api/tasks/task-1"), BOB)).andExpect(jsonPath("$.title").value("New pending title"))
            .andExpect(jsonPath("$.status").value("TODO")).andExpect(jsonPath("$.quadrant").value("SCHEDULE"));
        assertThat(outbox(BOB)).isEqualTo(pending);
    }

    @Test
    void aFieldChangedHereAndNotYetSentIsNotOverwrittenByAnOlderRemoteChange() throws Exception {
        register(BOB, "active");
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", List.of(
            Map.of("seq", 1, "ops", List.of(Map.of("table", "lists", "id", "list-1", "fields", Map.of("Name", "L")),
                Map.of("table", "tasks", "id", "task-1", "fields", Map.of("Title", "Old", "Status", "TODO", "ListId", "list-1")))))));
        send(inWorkspace(put("/api/tasks/task-1"), BOB), Map.of("title", "Bob's title")).andExpect(status().isOk());
        send(as(post("/api/sync/apply"), BOB), Map.of("workspaceId", WS, "changes", List.of(
            Map.of("seq", 2, "ops", List.of(Map.of("table", "tasks", "id", "task-1", "fields", Map.of("Title", "Alice's title", "Status", "DONE")))))));
        mvc.perform(inWorkspace(get("/api/tasks/task-1"), BOB)).andExpect(jsonPath("$.title").value("Bob's title"))
            .andExpect(jsonPath("$.status").value("DONE"));
    }

    @Test
    void assigningRecordsWhoAssignedFromTheAccountAndShowsUpInAssignedToMe() throws Exception {
        register(ALICE, "active");
        register(BOB, "active");
        send(inWorkspace(post("/api/lists"), ALICE), Map.of("name", "Shared", "clientId", "list-1")).andExpect(status().isCreated());
        send(inWorkspace(post("/api/tasks"), ALICE), Map.of("title", "Review", "listId", "list-1", "clientId", "task-1",
            "assigneeUserId", BOB, "assigneeName", "Bob", "assignedBy", "999999")).andExpect(status().isCreated())
            .andExpect(jsonPath("$.assigneeUserId").value(BOB)).andExpect(jsonPath("$.assignedBy").value(ALICE));
        mvc.perform(as(get("/api/sync/assigned"), BOB)).andExpect(jsonPath("$[0].title").value("Review"))
            .andExpect(jsonPath("$[0].workspaceName").value("Team"));
        mvc.perform(as(get("/api/sync/assigned"), ALICE)).andExpect(jsonPath("$.length()").value(0));
        send(inWorkspace(post("/api/tasks"), ALICE), Map.of("title", "Bad", "listId", "list-1", "assigneeUserId", "bob"))
            .andExpect(status().isBadRequest());
        send(inWorkspace(put("/api/tasks/task-1"), ALICE), Map.of("assigneeUserId", "")).andExpect(jsonPath("$.assigneeUserId").doesNotExist());
    }

    @Test
    void aRemovedMemberKeepsAReadOnlyCopy() throws Exception {
        register(BOB, "active");
        send(inWorkspace(post("/api/lists"), BOB), Map.of("name", "Shared")).andExpect(status().isCreated());
        register(BOB, "removed");
        mvc.perform(inWorkspace(get("/api/lists"), BOB)).andExpect(jsonPath("$[0].name").value("Shared"));
        send(inWorkspace(post("/api/lists"), BOB), Map.of("name", "New")).andExpect(status().isForbidden());
    }

    @Test
    void sharingCopiesListsAndTasksAsNewRowsAndLeavesTheOriginals() throws Exception {
        register(ALICE, "active");
        send(as(post("/api/lists"), ALICE), Map.of("name", "Work", "clientId", "mine-1")).andExpect(status().isCreated());
        send(as(post("/api/tasks"), ALICE), Map.of("title", "A", "listId", "mine-1")).andExpect(status().isCreated());
        send(as(post("/api/sync/seed"), ALICE), Map.of("workspaceId", WS, "listIds", List.of("mine-1")))
            .andExpect(jsonPath("$.lists").value(1)).andExpect(jsonPath("$.tasks").value(1));
        mvc.perform(as(get("/api/tasks"), ALICE)).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(inWorkspace(get("/api/tasks"), ALICE)).andExpect(jsonPath("$[0].title").value("A"))
            .andExpect(jsonPath("$[0].listId").value(org.hamcrest.Matchers.not("mine-1")));
        assertThat(outbox(ALICE)).hasSize(2);
    }
}
