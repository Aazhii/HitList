package com.hitlist;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import com.hitlist.domain.PageMarksService;
import com.hitlist.domain.TaskService;
import com.hitlist.domain.WorkspaceService;
import com.hitlist.storage.RowStore;
import com.hitlist.web.ApiExceptionHandler;
import com.hitlist.web.ListController;
import com.hitlist.web.NoteController;
import com.hitlist.web.PageMarksController;
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
    void clearingDueFieldsPersistsAcrossFreshReads() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/tasks").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"clientId":"clear-due","title":"Clear due date","dueDate":"2030-01-02","dueTime":"09:00",
                     "reminderEnabled":true,"reminderMinutesBefore":30,"recurrence":"DAILY"}
                    """))
            .andExpect(status().isCreated());
        mvc.perform(put("/api/tasks/clear-due").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"dueTime\":\"\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.dueDate").value("2030-01-02"))
            .andExpect(jsonPath("$.dueTime").isEmpty());
        mvc.perform(put("/api/tasks/clear-due").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"dueDate\":\"\",\"dueTime\":\"\",\"recurrence\":\"\",\"reminderEnabled\":false}"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/tasks/clear-due").cookie(browser)).andExpect(status().isOk())
            .andExpect(jsonPath("$.dueDate").isEmpty()).andExpect(jsonPath("$.dueTime").isEmpty())
            .andExpect(jsonPath("$.recurrence").isEmpty()).andExpect(jsonPath("$.reminderEnabled").value(false));
    }

    @Test
    void aTasksReminderIsKeptAndNotSwitchedOffByAnUnawareUpdate() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/tasks")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"clientId":"task-reminder","title":"Call the bank","dueDate":"2030-01-02","dueTime":"09:00",
                     "reminderEnabled":true,"reminderMinutesBefore":30}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.reminderEnabled").value(true))
            .andExpect(jsonPath("$.reminderMinutesBefore").value(30));

        // An update that does not mention the reminder leaves it alone.
        mvc.perform(post("/api/tasks/task-reminder?_method=PUT")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Call the bank today\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reminderEnabled").value(true))
            .andExpect(jsonPath("$.reminderMinutesBefore").value(30));

        mvc.perform(post("/api/tasks/task-reminder?_method=PUT")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reminderEnabled\":false}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.reminderEnabled").value(false))
            .andExpect(jsonPath("$.reminderMinutesBefore").isEmpty());

        mvc.perform(post("/api/tasks")
                .cookie(browser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Too early\",\"reminderEnabled\":true,\"reminderMinutesBefore\":99999}"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/trial-features").cookie(browser))
            .andExpect(jsonPath("$.notifications").value(true))
            .andExpect(jsonPath("$.automations").value(true));
    }

    @Test
    void finishingARepeatingTaskCreatesTheNextOnceAndUndoTakesItBack() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/tasks").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"clientId":"rec-1","title":"Water plants","dueDate":"2030-01-02","dueTime":"08:00",
                     "quadrant":"DO","recurrence":"WEEKLY"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.recurrence").value("WEEKLY"));

        mvc.perform(post("/api/tasks/rec-1?_method=PUT").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"DONE\"}"))
            .andExpect(status().isOk());
        String listed = mvc.perform(get("/api/tasks").cookie(browser)).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(listed).contains("\"dueDate\":\"2030-01-09\"", "\"dueTime\":\"08:00\"");
        org.assertj.core.api.Assertions.assertThat(listed.split("Water plants", -1).length - 1).isEqualTo(2);

        // Undo: the untouched copy goes away, and finishing again makes exactly one.
        mvc.perform(post("/api/tasks/rec-1?_method=PUT").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"TODO\"}"))
            .andExpect(status().isOk());
        listed = mvc.perform(get("/api/tasks").cookie(browser)).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(listed.split("Water plants", -1).length - 1).isEqualTo(1);
        mvc.perform(post("/api/tasks/rec-1/complete?_method=PATCH").cookie(browser)).andReturn();
        listed = mvc.perform(get("/api/tasks").cookie(browser)).andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(listed.split("Water plants", -1).length - 1).isEqualTo(2);

        mvc.perform(post("/api/tasks").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Bad\",\"recurrence\":\"HOURLY\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void aBackupRoundTripsAndImportOnlyEverAdds() throws Exception {
        MockCookie from = browser();
        MockCookie to = browser();
        mvc.perform(post("/api/tasks").cookie(from).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\"bk-1\",\"title\":\"Keep me\",\"dueDate\":\"2030-01-02\",\"recurrence\":\"DAILY\",\"reminderEnabled\":true,\"reminderMinutesBefore\":15}"))
            .andExpect(status().isCreated());

        String file = mvc.perform(get("/api/backup").cookie(from)).andExpect(status().isOk())
            .andExpect(jsonPath("$.schema").value("hitlist.backup.v1"))
            .andExpect(jsonPath("$.counts.KaizenTasks").value(1))
            .andReturn().getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(file).doesNotContain("OwnerId").doesNotContain("ROWID");

        mvc.perform(post("/api/backup").cookie(to).contentType(MediaType.APPLICATION_JSON).content(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.imported.KaizenTasks").value(1));
        mvc.perform(get("/api/tasks/bk-1").cookie(to)).andExpect(status().isOk())
            .andExpect(jsonPath("$.recurrence").value("DAILY"))
            .andExpect(jsonPath("$.reminderMinutesBefore").value(15));

        // Again: nothing is added and nothing is overwritten.
        mvc.perform(post("/api/tasks/bk-1?_method=PUT").cookie(to).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Edited\"}"))
            .andExpect(status().isOk());
        mvc.perform(post("/api/backup").cookie(to).contentType(MediaType.APPLICATION_JSON).content(file))
            .andExpect(jsonPath("$.imported.KaizenTasks").value(0))
            .andExpect(jsonPath("$.skipped.KaizenTasks").value(1));
        mvc.perform(get("/api/tasks/bk-1").cookie(to)).andExpect(jsonPath("$.title").value("Edited"));

        // The other owner's data is untouched, and a bad file changes nothing.
        mvc.perform(post("/api/backup").cookie(to).contentType(MediaType.APPLICATION_JSON)
                .content("{\"schema\":\"nope\",\"tables\":{}}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/backup").cookie(to).contentType(MediaType.APPLICATION_JSON)
                .content("{\"schema\":\"hitlist.backup.v1\",\"tables\":{\"KaizenZohoCalendarConnections\":[]}}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/backup").cookie(to).contentType(MediaType.APPLICATION_JSON)
                .content("{\"schema\":\"hitlist.backup.v1\",\"tables\":{\"KaizenTasks\":[{\"TaskId\":\"ok\",\"Title\":\"Fine\"},{\"TaskId\":\"bad\"}]}}"))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/api/tasks/ok").cookie(to)).andExpect(status().isNotFound());
    }

    @Test
    void importNeverAddsATaskThatAlreadyExistsUnderAnotherId() throws Exception {
        MockCookie owner = browser();
        mvc.perform(post("/api/tasks").cookie(owner).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\"here-1\",\"title\":\"Table audit\",\"dueDate\":\"2030-10-04\",\"quadrant\":\"SCHEDULE\"}"))
            .andExpect(status().isCreated());
        String file = "{\"schema\":\"hitlist.backup.v1\",\"tables\":{\"KaizenTasks\":["
            + "{\"TaskId\":\"other-1\",\"Title\":\"table audit\",\"DueDate\":\"2030-10-04\",\"Quadrant\":\"SCHEDULE\"},"
            + "{\"TaskId\":\"other-2\",\"Title\":\"Table audit\",\"DueDate\":\"2030-10-04\",\"Quadrant\":\"SCHEDULE\"},"
            + "{\"TaskId\":\"other-3\",\"Title\":\"Table audit\",\"DueDate\":\"2030-10-11\",\"Quadrant\":\"SCHEDULE\"}]}}";
        // One of the first two is the task already here; the other is genuinely a second one; the third is another day.
        mvc.perform(post("/api/backup").cookie(owner).contentType(MediaType.APPLICATION_JSON).content(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.imported.KaizenTasks").value(2))
            .andExpect(jsonPath("$.skipped.KaizenTasks").value(1));
        mvc.perform(get("/api/tasks").cookie(owner)).andExpect(jsonPath("$.length()").value(3));
    }

    @Test
    void catalystSignInNeverClaimsAnUnownedCookieWorkspace() throws Exception {
        RowStore store = new TestRowStore();
        HitListProperties cookieProps = properties();
        HitListProperties catalystProps = properties();
        catalystProps.setAuthMode("catalyst");
        MockMvc cookieMvc = mockMvc(store, cookieProps);
        MockMvc catalystMvc = mockMvc(store, catalystProps);

        // A workspace made before sign-in existed, under a browser cookie.
        MvcResult setup = cookieMvc.perform(get("/api/setup")).andReturn();
        String setCookie = setup.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        MockCookie old = new MockCookie(OwnerResolver.COOKIE_NAME, setCookie.substring(setCookie.indexOf('=') + 1, setCookie.indexOf(';')));
        cookieMvc.perform(post("/api/tasks").cookie(old).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\"before-signin\",\"title\":\"From before\"}"))
            .andExpect(status().isCreated());

        // Signed out: the project's own id is not a person, and a missing id is nobody. Only /api/session answers.
        catalystMvc.perform(get("/api/tasks").header("x-zc-user-id", "757330000000013053").header("x-zc-projectid", "757330000000013053"))
            .andExpect(status().isUnauthorized());
        catalystMvc.perform(get("/api/tasks")).andExpect(status().isUnauthorized());
        catalystMvc.perform(get("/api/session")).andExpect(status().isOk())
            .andExpect(jsonPath("$.authenticated").value(false))
            .andExpect(jsonPath("$.loginUrl").value("/__catalyst/auth/login"));
        catalystMvc.perform(get("/api/health")).andExpect(status().isOk()); // the service check stays open

        catalystMvc.perform(get("/api/tasks").header("x-zc-user-id", "757330000000099001").header("x-zc-projectid", "757330000000013053"))
            .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        catalystMvc.perform(get("/api/session").cookie(old).header("x-zc-user-id", "757330000000099001").header("x-zc-projectid", "757330000000013053"))
            .andExpect(jsonPath("$.authenticated").value(true))
            .andExpect(jsonPath("$.userId").value("757330000000099001"))
            .andExpect(jsonPath("$.claimed").doesNotExist());
        catalystMvc.perform(get("/api/tasks/before-signin").header("x-zc-user-id", "757330000000099001").header("x-zc-projectid", "757330000000013053"))
            .andExpect(status().isNotFound());

        catalystMvc.perform(get("/api/session").cookie(old).header("x-zc-user-id", "757330000000099001").header("x-zc-projectid", "757330000000013053"))
            .andExpect(jsonPath("$.claimed").doesNotExist());
        catalystMvc.perform(get("/api/tasks/before-signin").header("x-zc-user-id", "757330000000099002").header("x-zc-projectid", "757330000000013053"))
            .andExpect(status().isNotFound());
        cookieMvc.perform(get("/api/tasks/before-signin").cookie(old)).andExpect(status().isOk());
        catalystMvc.perform(post("/api/tasks").header("x-zc-user-id", "757330000000099001")
                .contentType(MediaType.APPLICATION_JSON).content("{\"clientId\":\"account-a-private\",\"title\":\"Only A\"}"))
            .andExpect(status().isCreated());
        catalystMvc.perform(get("/api/tasks/account-a-private").cookie(old).header("x-zc-user-id", "757330000000099002"))
            .andExpect(status().isNotFound());
    }

    @Test
    void desktopAccountsNeverClaimUnownedDataAndRequireTheShellSecret() throws Exception {
        String secret = "desktop-launch-secret-0123456789abcdef";
        String alice = "A".repeat(43);
        String bob = "B".repeat(43);
        RowStore store = new TestRowStore();
        HitListProperties cookieProps = properties();
        HitListProperties desktopProps = properties();
        desktopProps.setAuthMode("desktop");
        desktopProps.setDesktopToken(secret);
        MockMvc cookieMvc = mockMvc(store, cookieProps);
        MockMvc desktopMvc = mockMvc(store, desktopProps);

        // A workspace made before sign-in, under the browser cookie.
        MvcResult setup = desktopMvc.perform(get("/api/setup")).andReturn();
        String setCookie = setup.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        MockCookie old = new MockCookie(OwnerResolver.COOKIE_NAME, setCookie.substring(setCookie.indexOf('=') + 1, setCookie.indexOf(';')));
        desktopMvc.perform(post("/api/tasks").cookie(old).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\"local-first\",\"title\":\"Made before signing in\"}"))
            .andExpect(status().isCreated());

        // Signed out the app still opens and works from the cookie workspace.
        desktopMvc.perform(get("/api/session").cookie(old)).andExpect(jsonPath("$.mode").value("desktop"))
            .andExpect(jsonPath("$.authenticated").value(false));
        desktopMvc.perform(get("/api/tasks/local-first").cookie(old)).andExpect(status().isOk());

        // A wrong or missing secret never names an account: the request stays on the cookie workspace.
        desktopMvc.perform(get("/api/tasks/local-first").cookie(old).header("X-Hitlist-Desktop-Owner", alice)
                .header("X-Hitlist-Desktop-Token", "not-the-secret-not-the-secret-not-the-secret"))
            .andExpect(status().isOk());
        desktopMvc.perform(get("/api/session").cookie(old).header("X-Hitlist-Desktop-Owner", alice))
            .andExpect(jsonPath("$.authenticated").value(false));

        desktopMvc.perform(get("/api/tasks").header("X-Hitlist-Desktop-Owner", alice).header("X-Hitlist-Desktop-Token", secret))
            .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        desktopMvc.perform(get("/api/session").cookie(old).header("X-Hitlist-Desktop-Owner", alice).header("X-Hitlist-Desktop-Token", secret))
            .andExpect(jsonPath("$.authenticated").value(true)).andExpect(jsonPath("$.userId").value(alice))
            .andExpect(jsonPath("$.claimed").doesNotExist());
        desktopMvc.perform(get("/api/tasks/local-first").header("X-Hitlist-Desktop-Owner", alice).header("X-Hitlist-Desktop-Token", secret))
            .andExpect(status().isNotFound());
        desktopMvc.perform(get("/api/session").cookie(old).header("X-Hitlist-Desktop-Owner", alice).header("X-Hitlist-Desktop-Token", secret))
            .andExpect(jsonPath("$.claimed").doesNotExist());

        desktopMvc.perform(get("/api/tasks/local-first").header("X-Hitlist-Desktop-Owner", bob).header("X-Hitlist-Desktop-Token", secret))
            .andExpect(status().isNotFound());
        desktopMvc.perform(get("/api/tasks/local-first").cookie(old)).andExpect(status().isOk());
        desktopMvc.perform(post("/api/tasks").header("X-Hitlist-Desktop-Owner", alice).header("X-Hitlist-Desktop-Token", secret)
                .contentType(MediaType.APPLICATION_JSON).content("{\"clientId\":\"account-a-private\",\"title\":\"Only A\"}"))
            .andExpect(status().isCreated());
        desktopMvc.perform(get("/api/tasks/account-a-private").cookie(old).header("X-Hitlist-Desktop-Owner", bob).header("X-Hitlist-Desktop-Token", secret))
            .andExpect(status().isNotFound());

        // Without a real secret configured the mode is plain cookie mode: a named account is ignored.
        HitListProperties noSecret = properties();
        noSecret.setAuthMode("desktop");
        MockMvc plain = mockMvc(store, noSecret);
        plain.perform(get("/api/tasks/local-first").header("X-Hitlist-Desktop-Owner", alice).header("X-Hitlist-Desktop-Token", ""))
            .andExpect(status().isNotFound());
    }

    @Test
    void favoritesAndRecentsAreKeptPerOwnerAndTrimmed() throws Exception {
        MockCookie browser = browser();
        MockCookie other = browser();

        mvc.perform(put("/api/favorites/note/n1").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.kind").value("note"))
            .andExpect(jsonPath("$.id").value("n1"));
        // Starring twice is still one favourite.
        mvc.perform(put("/api/favorites/note/n1").cookie(browser)).andExpect(status().isOk());
        mvc.perform(put("/api/favorites/database/d1").cookie(browser)).andExpect(status().isOk());
        mvc.perform(get("/api/favorites").cookie(browser))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].id").value("n1"));
        mvc.perform(get("/api/favorites").cookie(other)).andExpect(jsonPath("$.length()").value(0));

        mvc.perform(put("/api/favorites/folder/x").cookie(browser)).andExpect(status().isBadRequest());

        mvc.perform(delete("/api/favorites/note/n1").cookie(browser)).andExpect(status().isNoContent());
        mvc.perform(get("/api/favorites").cookie(browser))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].id").value("d1"));

        for (int i = 0; i < 25; i++) {
            mvc.perform(post("/api/recents/note/page" + i).cookie(browser)).andExpect(status().isOk());
        }
        // Opening one again moves it to the top rather than adding a second row.
        mvc.perform(post("/api/recents/note/page24").cookie(browser)).andExpect(status().isOk());
        mvc.perform(get("/api/recents").cookie(browser))
            .andExpect(jsonPath("$.length()").value(20))
            .andExpect(jsonPath("$[0].id").value("page24"));
        mvc.perform(delete("/api/recents/note/page24").cookie(browser)).andExpect(status().isNoContent());
        mvc.perform(get("/api/recents").cookie(browser)).andExpect(jsonPath("$.length()").value(19));
    }

    @Test
    void automationRulesAreStoredRunByHandAndRejectBadSteps() throws Exception {
        MockCookie browser = browser();
        mvc.perform(post("/api/tasks").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientId\":\"t-auto\",\"title\":\"Send the report\",\"dueDate\":\"2030-01-02\",\"dueTime\":\"09:00\"}"))
            .andExpect(status().isCreated());

        String created = mvc.perform(post("/api/automations").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"Before it is due","taskId":"t-auto","triggerType":"due-date","status":"active",
                     "urgency":"high","offsetMinutes":[-60,-15],"notifyInApp":true,"notifyBrowser":false,"timezone":"Asia/Kolkata"}
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("Before it is due"))
            .andExpect(jsonPath("$.offsetMinutes.length()").value(2))
            .andReturn().getResponse().getContentAsString();
        String id = new ObjectMapper().readTree(created).get("id").asText();

        mvc.perform(get("/api/automations").cookie(browser)).andExpect(jsonPath("$.length()").value(1));

        mvc.perform(put("/api/automations/" + id).cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"paused\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("paused"))
            .andExpect(jsonPath("$.name").value("Before it is due"));

        mvc.perform(post("/api/automations/" + id + "/trigger").cookie(browser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.source").value("manual"))
            .andExpect(jsonPath("$.status").value("SUCCESS"));
        mvc.perform(get("/api/automations/" + id + "/runs").cookie(browser)).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/automations/runs").cookie(browser)).andExpect(jsonPath("$[0].ruleName").value("Before it is due"));
        // Run by hand raised an in-app notification the bell can read.
        mvc.perform(get("/api/notifications").cookie(browser))
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].title").value("Send the report"));

        mvc.perform(post("/api/automations").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Too many\",\"offsetMinutes\":[1,2,3,4,5,6]}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/automations").cookie(browser).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Odd\",\"offsetMinutes\":[1.5]}"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/automations").cookie(other())).andExpect(jsonPath("$.length()").value(0));

        mvc.perform(delete("/api/automations/" + id).cookie(browser)).andExpect(status().isNoContent());
        mvc.perform(get("/api/automations").cookie(browser)).andExpect(jsonPath("$.length()").value(0));
    }

    private MockCookie other() throws Exception {
        return browser();
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
        // Change a character in the middle: the last base64 character can carry unused bits, so
        // changing only that one is sometimes not a change at all.
        int middle = firstValue.length() / 2;
        String forgedValue = firstValue.substring(0, middle)
            + (firstValue.charAt(middle) == 'A' ? 'B' : 'A') + firstValue.substring(middle + 1);
        mvc.perform(get("/api/tasks/private-task").cookie(new MockCookie(OwnerResolver.COOKIE_NAME, forgedValue)))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/tasks/private-task").cookie(firstBrowser))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.title").value("Private task"));
    }

    private MockMvc mockMvc() {
        return mockMvc(new TestRowStore(), properties());
    }

    private MockMvc mockMvc(RowStore store, HitListProperties props) {
        EntityRepository repository = new EntityRepository(store);
        OwnerResolver owners = new OwnerResolver(props);
        ObjectMapper objectMapper = new ObjectMapper();
        MappingJackson2HttpMessageConverter converter = new MappingJackson2HttpMessageConverter(objectMapper);
        converter.setSupportedMediaTypes(List.of(MediaType.APPLICATION_JSON, MediaType.TEXT_PLAIN));

        return MockMvcBuilders.standaloneSetup(
                new PlatformController(repository, owners),
                new TaskController(new TaskService(repository), owners),
                new StatsController(new TaskService(repository), owners),
                new ListController(new ListService(repository), owners),
                new NoteController(new NoteService(repository), owners),
                new WorkspaceController(new WorkspaceService(repository, objectMapper), owners),
                new PageMarksController(new PageMarksService(repository), owners),
                new com.hitlist.web.BackupController(new com.hitlist.domain.WorkspaceBackupService(repository), owners),
                new com.hitlist.web.SessionController(owners)
            )
            .setControllerAdvice(new ApiExceptionHandler())
            .setMessageConverters(converter)
            .addFilters(new OwnerSessionFilter(owners), new SimpleRequestFilter(props))
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
