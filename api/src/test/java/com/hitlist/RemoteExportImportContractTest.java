package com.hitlist;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.auth.OwnerResolver;
import com.hitlist.auth.OwnerSessionFilter;
import com.hitlist.config.HitListProperties;
import com.hitlist.domain.EntityRepository;
import com.hitlist.domain.ListService;
import com.hitlist.domain.NoteService;
import com.hitlist.domain.RemoteExportImportService;
import com.hitlist.domain.TaskService;
import com.hitlist.domain.WorkspaceService;
import com.hitlist.storage.RowStore;
import com.hitlist.web.ApiExceptionHandler;
import com.hitlist.web.ListController;
import com.hitlist.web.MigrationController;
import com.hitlist.web.NoteController;
import com.hitlist.web.PlatformController;
import com.hitlist.web.SimpleRequestFilter;
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

class RemoteExportImportContractTest {
    private final MockMvc mvc = mockMvc();

    @Test
    void importsCanonicalRemoteExportOnceAndPreservesCompletedAt() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/migrations/remote-export")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "schema": "hitlist.remote-export.v1",
                      "exportedAt": "2026-09-25T18:00:00Z",
                      "collections": {
                        "lists": [
                          {
                            "id": "list-1",
                            "name": "Inbox",
                            "color": "emerald",
                            "listOrder": 0,
                            "createdAt": "2026-09-25T17:50:00Z",
                            "updatedAt": "2026-09-25T17:50:00Z"
                          }
                        ],
                        "tasks": [
                          {
                            "id": "task-1",
                            "title": "Ship importer",
                            "status": "DONE",
                            "quadrant": "DO",
                            "priority": "HIGH",
                            "note": "Document the flow",
                            "listId": "list-1",
                            "taskOrder": 0,
                            "reminderEnabled": false,
                            "reminderMinutesBefore": null,
                            "completedAt": "2026-09-25T17:56:00Z",
                            "createdAt": "2026-09-25T17:51:00Z",
                            "updatedAt": "2026-09-25T17:56:00Z",
                            "sourceNoteId": "note-1",
                            "sourceBlockId": "block-1"
                          }
                        ],
                        "notes": [
                          {
                            "id": "note-1",
                            "title": "Migration plan",
                            "blocksJson": "[]",
                            "emoji": "📝",
                            "pinned": true,
                            "createdAt": 1727286900000,
                            "updatedAt": 1727286900000
                          }
                        ],
                        "views": [
                          {
                            "id": "view-1",
                            "name": "All tasks",
                            "layout": "list",
                            "scopeListId": "list-1",
                            "filters": {},
                            "showDone": true,
                            "display": { "hidden": [], "order": [], "widths": {} },
                            "viewOrder": 0,
                            "createdAt": 1727286900000,
                            "updatedAt": 1727286900000
                          }
                        ],
                        "fields": [
                          {
                            "id": "task-field-1",
                            "databaseId": "",
                            "name": "Estimate",
                            "kind": "number",
                            "options": [],
                            "showOnCard": true,
                            "fieldOrder": 0,
                            "createdAt": 1727286900000,
                            "updatedAt": 1727286900000
                          },
                          {
                            "id": "db-field-1",
                            "databaseId": "db-1",
                            "name": "Published",
                            "kind": "date",
                            "options": [],
                            "showOnCard": false,
                            "fieldOrder": 0,
                            "createdAt": 1727286900000,
                            "updatedAt": 1727286900000
                          }
                        ],
                        "taskFieldValues": [
                          { "taskId": "task-1", "fieldId": "task-field-1", "value": 5 }
                        ],
                        "databases": [
                          {
                            "id": "db-1",
                            "name": "Books",
                            "icon": "📚",
                            "dateFieldId": "db-field-1",
                            "dbOrder": 0,
                            "createdAt": 1727286900000,
                            "updatedAt": 1727286900000
                          }
                        ],
                        "databaseRows": [
                          {
                            "id": "row-1",
                            "databaseId": "db-1",
                            "title": "Dune",
                            "rowOrder": 0,
                            "createdAt": 1727286900000,
                            "updatedAt": 1727286900000
                          }
                        ],
                        "recordFieldValues": [
                          { "recordId": "row-1", "fieldId": "db-field-1", "value": "2026-01-01" }
                        ]
                      }
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.ok").value(true))
            .andExpect(jsonPath("$.schema").value("hitlist.remote-export.v1"))
            .andExpect(jsonPath("$.counts.tasks").value(1))
            .andExpect(jsonPath("$.counts.recordFieldValues").value(1));

        mvc.perform(get("/api/tasks").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value("task-1"))
            .andExpect(jsonPath("$[0].completedAt").value("2026-09-25T17:56:00Z"))
            .andExpect(jsonPath("$[0].sourceNoteId").value("note-1"))
            .andExpect(jsonPath("$[0].sourceBlockId").value("block-1"));

        mvc.perform(get("/api/notes").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value("note-1"))
            .andExpect(jsonPath("$[0].pinned").value(true));

        mvc.perform(get("/api/views").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value("view-1"))
            .andExpect(jsonPath("$[0].scopeListId").value("list-1"));

        mvc.perform(get("/api/field-values").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].taskId").value("task-1"))
            .andExpect(jsonPath("$[0].fieldId").value("task-field-1"))
            .andExpect(jsonPath("$[0].value").value(5.0));

        mvc.perform(get("/api/databases").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value("db-1"))
            .andExpect(jsonPath("$[0].dateFieldId").value("db-field-1"));

        mvc.perform(get("/api/databases/db-1/rows").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].id").value("row-1"));

        mvc.perform(get("/api/databases/db-1/field-values").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].recordId").value("row-1"))
            .andExpect(jsonPath("$[0].fieldId").value("db-field-1"))
            .andExpect(jsonPath("$[0].value").value("2026-01-01"));

        mvc.perform(post("/api/migrations/remote-export")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"schema":"hitlist.remote-export.v1","collections":{"lists":[],"tasks":[],"notes":[],"views":[],"fields":[],"taskFieldValues":[],"databases":[],"databaseRows":[],"recordFieldValues":[]}}
                    """))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("conflict"))
            .andExpect(jsonPath("$.message").value("Remote export has already been imported for this owner"));
    }

    @Test
    void rejectsForgedOwnerMetadataAndUnsupportedReminderData() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/migrations/remote-export")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "schema": "hitlist.remote-export.v1",
                      "collections": {
                        "lists": [],
                        "tasks": [
                          {
                            "id": "task-1",
                            "title": "Unsafe",
                            "status": "TODO",
                            "quadrant": "DO",
                            "reminderEnabled": true,
                            "createdAt": "2026-09-25T17:51:00Z",
                            "updatedAt": "2026-09-25T17:51:00Z"
                          }
                        ],
                        "notes": [],
                        "views": [],
                        "fields": [],
                        "taskFieldValues": [],
                        "databases": [],
                        "databaseRows": [],
                        "recordFieldValues": []
                      }
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("collections.tasks[0] contains reminder data, which is not supported by this importer"));

        mvc.perform(post("/api/migrations/remote-export")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "schema": "hitlist.remote-export.v1",
                      "collections": {
                        "lists": [
                          {
                            "id": "list-1",
                            "name": "Inbox",
                            "OwnerId": "forged-owner"
                          }
                        ],
                        "tasks": [],
                        "notes": [],
                        "views": [],
                        "fields": [],
                        "taskFieldValues": [],
                        "databases": [],
                        "databaseRows": [],
                        "recordFieldValues": []
                      }
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("$.collections.lists[0].OwnerId is not allowed; owner and row metadata come from the server"));
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
                new ListController(new ListService(repository), owners),
                new NoteController(new NoteService(repository), owners),
                new WorkspaceController(new WorkspaceService(repository, objectMapper), owners),
                new MigrationController(new RemoteExportImportService(repository, objectMapper), owners)
            )
            .setControllerAdvice(new ApiExceptionHandler())
            .setMessageConverters(converter)
            .addFilters(new OwnerSessionFilter(owners), simpleRequestFilter())
            .build();
    }

    private MockCookie browser() throws Exception {
        MvcResult result = mvc.perform(get("/api/setup")).andExpect(status().isOk()).andReturn();
        String setCookie = result.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        String value = setCookie.substring(setCookie.indexOf('=') + 1, setCookie.indexOf(';'));
        return new MockCookie(OwnerResolver.COOKIE_NAME, value);
    }

    private Filter simpleRequestFilter() {
        return new SimpleRequestFilter(properties());
    }

    private HitListProperties properties() {
        HitListProperties properties = new HitListProperties();
        properties.setOwnerCookieSecret("migration-test-owner-cookie-secret");
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
