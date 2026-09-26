package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.TaskService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StatsController {
    private final TaskService tasks;
    private final OwnerResolver owners;

    public StatsController(TaskService tasks, OwnerResolver owners) {
        this.tasks = tasks;
        this.owners = owners;
    }

    @GetMapping("/api/stats/momentum")
    Map<String, Object> momentum(@RequestParam(required = false) String listId, HttpServletRequest request) {
        return tasks.momentum(owners.owner(request), listId, timeZone(request));
    }

    private String timeZone(HttpServletRequest request) {
        String timezone = request.getHeader("X-Timezone");
        return timezone == null || timezone.isBlank() ? request.getParameter("tz") : timezone;
    }
}
