package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.TaskService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {
    private final TaskService tasks;
    private final OwnerResolver owners;

    public TaskController(TaskService tasks, OwnerResolver owners) {
        this.tasks = tasks;
        this.owners = owners;
    }

    @GetMapping
    public java.util.List<Map<String, Object>> list(@RequestParam Map<String, String> query, HttpServletRequest request) {
        return tasks.list(owners.owner(request), query);
    }

    @GetMapping("/today-history")
    public java.util.List<Map<String, Object>> todayHistory(@RequestParam(required = false) String listId, HttpServletRequest request) {
        return tasks.todayHistory(owners.owner(request), listId, timeZone(request));
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable String id, HttpServletRequest request) {
        return tasks.get(owners.owner(request), id);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(tasks.create(owners.owner(request), body));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        return tasks.update(owners.owner(request), id, body);
    }

    @PatchMapping("/{id}/status")
    public Map<String, Object> status(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        Object status = body.get("status");
        if (!(status instanceof String value)) throw ApiException.invalid("status is required");
        return tasks.status(owners.owner(request), id, value);
    }

    @PatchMapping("/{id}/complete")
    public Map<String, Object> complete(@PathVariable String id, HttpServletRequest request) {
        return tasks.complete(owners.owner(request), id);
    }

    @PatchMapping("/{id}/quadrant")
    public Map<String, Object> quadrant(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        Object quadrant = body.get("quadrant");
        if (!(quadrant instanceof String value)) throw ApiException.invalid("quadrant is required");
        return tasks.quadrant(owners.owner(request), id, value);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id, HttpServletRequest request) {
        tasks.delete(owners.owner(request), id);
        return ResponseEntity.noContent().build();
    }

    private String timeZone(HttpServletRequest request) {
        String timezone = request.getHeader("X-Timezone");
        return timezone == null || timezone.isBlank() ? request.getParameter("tz") : timezone;
    }
}
