package com.kaizen.todo.controller;

import com.kaizen.todo.dto.TaskRequest;
import com.kaizen.todo.dto.TaskResponse;
import com.kaizen.todo.model.Quadrant;
import com.kaizen.todo.model.TaskStatus;
import com.kaizen.todo.service.TaskService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST controller for task management.
 *
 * GET    /api/tasks                      — list all tasks (optional ?listId=&status=)
 * GET    /api/tasks/{id}                 — single task
 * GET    /api/tasks/today-history        — tasks completed today (optional ?listId=)
 * POST   /api/tasks                      — create task
 * PUT    /api/tasks/{id}                 — full update
 * PATCH  /api/tasks/{id}/status          — change status only
 * PATCH  /api/tasks/{id}/complete        — mark done + record completedAt
 * PATCH  /api/tasks/{id}/quadrant        — reprioritize (change quadrant only)
 * DELETE /api/tasks/{id}                 — delete task
 */
@RestController
@RequestMapping("/api/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final TaskService taskService;

    // ── Queries ──────────────────────────────────────────────────────────────

    @GetMapping
    public ResponseEntity<List<TaskResponse>> getAllTasks(
            @RequestParam(required = false) UUID listId,
            @RequestParam(required = false) TaskStatus status) {
        return ResponseEntity.ok(taskService.getAllTasks(listId, status));
    }

    @GetMapping("/today-history")
    public ResponseEntity<List<TaskResponse>> getTodayHistory(
            @RequestParam(required = false) UUID listId) {
        return ResponseEntity.ok(taskService.getTodayHistory(listId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<TaskResponse> getTask(@PathVariable UUID id) {
        return ResponseEntity.ok(taskService.getTaskById(id));
    }

    // ── Mutations ────────────────────────────────────────────────────────────

    @PostMapping
    public ResponseEntity<TaskResponse> createTask(@Valid @RequestBody TaskRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(taskService.createTask(req));
    }

    @PutMapping("/{id}")
    public ResponseEntity<TaskResponse> updateTask(
            @PathVariable UUID id,
            @Valid @RequestBody TaskRequest req) {
        return ResponseEntity.ok(taskService.updateTask(id, req));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<TaskResponse> updateStatus(
            @PathVariable UUID id,
            @RequestBody Map<String, String> body) {

        String rawStatus = body.get("status");
        if (rawStatus == null || rawStatus.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        TaskStatus newStatus;
        try {
            newStatus = TaskStatus.valueOf(rawStatus.toUpperCase());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(taskService.updateStatus(id, newStatus));
    }

    @PatchMapping("/{id}/complete")
    public ResponseEntity<TaskResponse> markComplete(@PathVariable UUID id) {
        return ResponseEntity.ok(taskService.markComplete(id));
    }

    /**
     * PATCH /api/tasks/{id}/quadrant
     * Body: { "quadrant": "SCHEDULE" }
     * Reprioritizes a task without touching any other field.
     */
    @PatchMapping("/{id}/quadrant")
    public ResponseEntity<TaskResponse> reprioritize(
            @PathVariable UUID id,
            @RequestBody Map<String, String> body) {

        String rawQuadrant = body.get("quadrant");
        if (rawQuadrant == null || rawQuadrant.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        Quadrant quadrant;
        try {
            quadrant = Quadrant.valueOf(rawQuadrant.toUpperCase());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(taskService.reprioritize(id, quadrant));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteTask(@PathVariable UUID id) {
        taskService.deleteTask(id);
        return ResponseEntity.noContent().build();
    }
}
