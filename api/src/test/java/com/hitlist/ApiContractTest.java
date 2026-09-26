package com.hitlist;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.auth.OwnerResolver;
import com.hitlist.auth.OwnerSessionFilter;
import com.hitlist.config.HitListProperties;
import com.hitlist.domain.EntityRepository;
import com.hitlist.domain.ListService;
import com.hitlist.domain.NoteService;
import com.hitlist.domain.TaskService;
import com.hitlist.domain.WorkspaceService;
import com.hitlist.storage.RowStore;
import com.hitlist.web.ApiExceptionHandler;
import com.hitlist.web.ListController;
import com.hitlist.web.NoteController;
import com.hitlist.web.PlatformController;
import com.hitlist.web.SimpleRequestFilter;
import com.hitlist.web.StatsController;
import com.hitlist.web.TaskController;
import com.hitlist.web.WorkspaceController;
import jakarta.servlet.Filter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockCookie;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ApiContractTest {
    private final MockMvc mvc = mockMvc();

    @Test
    void healthAndTaskContractMatchTheFrontendApi() throws Exception {
        mvc.perform(get("/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ok").value(true));

        MockCookie browser = browser();

        mvc.perform(get("/api/setup").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.mode").value("postgres"))
            .andExpect(jsonPath("$.message").value("PostgreSQL-backed storage is configured."));

        mvc.perform(post("/api/tasks")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"clientId":"task-contract","title":"Ship Java migration","status":"TODO",
                     "quadrant":"DO","taskOrder":2,"reminderEnabled":false}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("task-contract"))
            .andExpect(jsonPath("$.status").value("TODO"))
            .andExpect(jsonPath("$.reminderEnabled").value(false))
            .andExpect(jsonPath("$.reminderMinutesBefore").isEmpty())
            .andExpect(jsonPath("$.createdAt").isString());

        mvc.perform(post("/api/tasks/task-contract/status?_method=PATCH&tz=Asia%2FKolkata")
                .cookie(browser)
                .contentType(MediaType.TEXT_PLAIN)
                .content("{\"status\":\"DONE\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DONE"))
            .andExpect(jsonPath("$.completedAt").isString());

        mvc.perform(get("/api/tasks").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value("task-contract"));
    }

    @Test
    void notesListsAndWorkspaceRoutesRetainTheirApiShapes() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/lists")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\"list-contract\",\"name\":\"Engineering\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("list-contract"));

        mvc.perform(post("/api/notes")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"id\":\"note-contract\",\"title\":\"Migration\",\"blocksJson\":\"[]\",\"updatedAt\":1}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value("note-contract"))
            .andExpect(jsonPath("$.pinned").value(false));

        mvc.perform(post("/api/fields")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Estimate\",\"kind\":\"number\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.kind").value("number"));

        mvc.perform(get("/api/calendar").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.tasks").isArray())
            .andExpect(jsonPath("$.records").isArray());
    }

    @Test
    void momentumContractSupportsInitialSync() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/tasks")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"clientId":"completed-task","title":"Already completed","status":"DONE",
                     "quadrant":"DO","completedAt":"2026-09-24T12:34:56Z"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.completedAt").value("2026-09-24T12:34:56Z"));

        mvc.perform(get("/api/stats/momentum?tz=UTC").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.streak").isNumber())
            .andExpect(jsonPath("$.totalCompleted").value(1))
            .andExpect(jsonPath("$.todayCompleted").isNumber())
            .andExpect(jsonPath("$.listId").value(""))
            .andExpect(jsonPath("$.asOf").isString());
    }

    @Test
    void browserSessionsCannotReadEachOthersDataOrChooseAnOwnerHeader() throws Exception {
        MockCookie firstBrowser = browser();
        mvc.perform(post("/api/tasks")
                .cookie(firstBrowser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"clientId":"private-task","title":"Private task","status":"TODO","quadrant":"DO"}
                    """))
            .andExpect(status().isCreated());

        MockCookie secondBrowser = browser();
        mvc.perform(get("/api/tasks").cookie(secondBrowser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/tasks/private-task")
                .cookie(secondBrowser)
                .header("X-Owner-Id", firstBrowser.getValue()))
            .andExpect(status().isNotFound());
        String firstValue = firstBrowser.getValue();
        String forgedValue = firstValue.substring(0, firstValue.length() - 1)
            + (firstValue.endsWith("A") ? "B" : "A");
        mvc.perform(get("/api/tasks/private-task").cookie(new MockCookie(OwnerResolver.COOKIE_NAME, forgedValue)))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/tasks/private-task").cookie(firstBrowser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Private task"));
    }

    private MockMvc mockMvc() {
        RowStore store = new TestRowStore();
        EntityRepository repository = new EntityRepository(store);
        OwnerResolver owners = new OwnerResolver(properties());
        ObjectMapper objectMapper = new ObjectMapper();
        MappingJackson2HttpMessageConverter converter = new MappingJackson2HttpMessageConverter(objectMapper);
        converter.setSupportedMediaTypes(List.of(MediaType.APPLICATION_JSON, MediaType.TEXT_PLAIN));

        return MockMvcBuilders.standaloneSetup(
                new PlatformController(repository, owners),
                new TaskController(new TaskService(repository), owners),
                new StatsController(new TaskService(repository), owners),
                new ListController(new ListService(repository), owners),
                new NoteController(new NoteService(repository), owners),
                new WorkspaceController(new WorkspaceService(repository, objectMapper), owners)
            )
            .setControllerAdvice(new ApiExceptionHandler())
            .setMessageConverters(converter)
            .addFilters(new OwnerSessionFilter(owners), simpleRequestFilter())
            .build();
    }

    private MockCookie browser() throws Exception {
        MvcResult result = mvc.perform(get("/api/setup")).andExpect(status().isOk()).andReturn();
        String setCookie = result.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        assertTrue(setCookie.contains("HttpOnly"));
        assertTrue(setCookie.contains("SameSite=Lax"));
        String value = setCookie.substring(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
        return new MockCookie(OwnerResolver.COOKIE_NAME, value);
    }

    private Filter simpleRequestFilter() {
        return new SimpleRequestFilter(properties());
    }

    private HitListProperties properties() {
        HitListProperties properties = new HitListProperties();
        properties.setOwnerCookieSecret("contract-test-owner-cookie-secret");
        return properties;
    }

    private static final class TestRowStore implements RowStore {
        private final Map<String, List<Map<String, Object>>> tables = new LinkedHashMap<>();
        private long nextRowId = 1L;

        @Override
        public List<Map<String, Object>> findByOwner(String table, String ownerId) {
            return table(table).stream()
                .filter(row -> ownerId.equals(String.valueOf(row.getOrDefault("OwnerId", ""))))
                .<Map<String, Object>>map(row -> new LinkedHashMap<>(row))
                .toList();
        }

        @Override
        public Map<String, Object> insert(String table, Map<String, Object> row) {
            Map<String, Object> stored = new LinkedHashMap<>(row);
            stored.put("ROWID", String.valueOf(nextRowId++));
            table(table).add(stored);
            return new LinkedHashMap<>(stored);
        }

        @Override
        public Map<String, Object> update(String table, String rowId, Map<String, Object> row) {
            List<Map<String, Object>> rows = table(table);
            for (int index = 0; index < rows.size(); index++) {
                if (rowId.equals(String.valueOf(rows.get(index).get("ROWID")))) {
                    Map<String, Object> stored = new LinkedHashMap<>(row);
                    stored.put("ROWID", rowId);
                    rows.set(index, stored);
                    return new LinkedHashMap<>(stored);
                }
            }
            throw new IllegalStateException("missing row " + rowId);
        }

        @Override
        public void delete(String table, String rowId) {
            table(table).removeIf(row -> rowId.equals(String.valueOf(row.get("ROWID"))));
        }

        @Override
        public String mode() {
            return "postgres";
        }

        private List<Map<String, Object>> table(String table) {
            tables.computeIfAbsent(table, ignored -> new ArrayList<>());
            return tables.get(table);
        }
    }
}
