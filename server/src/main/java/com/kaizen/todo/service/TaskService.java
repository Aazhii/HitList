package com.kaizen.todo.service;

import com.kaizen.todo.dto.TaskRequest;
import com.kaizen.todo.dto.TaskResponse;
import com.kaizen.todo.model.Quadrant;
import com.kaizen.todo.model.Task;
import com.kaizen.todo.model.TaskStatus;
import com.kaizen.todo.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TaskService {

    private final TaskRepository taskRepository;
    private final MomentumService momentumService;

    // ── Queries ──────────────────────────────────────────────────────────────

    public List<TaskResponse> getAllTasks(UUID listId, TaskStatus status) {
        if (listId != null && status != null) {
            return taskRepository.findByListIdAndStatusOrderByTaskOrderAscCreatedAtAsc(listId, status)
                    .stream().map(TaskResponse::from).collect(Collectors.toList());
        }
        if (listId != null) {
            return taskRepository.findByListIdOrderByTaskOrderAscCreatedAtAsc(listId)
                    .stream().map(TaskResponse::from).collect(Collectors.toList());
        }
        if (status != null) {
            return taskRepository.findByStatusOrderByCompletedAtDesc(status)
                    .stream().map(TaskResponse::from).collect(Collectors.toList());
        }
        return taskRepository.findAllByOrderByTaskOrderAscCreatedAtAsc()
                .stream().map(TaskResponse::from).collect(Collectors.toList());
    }

    public TaskResponse getTaskById(UUID id) {
        return TaskResponse.from(findOrThrow(id));
    }

    /**
     * Returns tasks completed today (UTC) — powers the Today's History panel.
     * Optionally scoped to a list.
     */
    public List<TaskResponse> getTodayHistory(UUID listId) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        Instant start = today.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant end   = today.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();

        List<Task> tasks = listId != null
                ? taskRepository.findCompletedBetweenByList(listId, start, end)
                : taskRepository.findCompletedBetween(start, end);

        return tasks.stream().map(TaskResponse::from).collect(Collectors.toList());
    }

    // ── Mutations ────────────────────────────────────────────────────────────

    @Transactional
    public TaskResponse createTask(TaskRequest req) {
        if (req.getTitle() == null || req.getTitle().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Title is required");
        }

        Task task = Task.builder()
                .title(req.getTitle().trim())
                .status(req.getStatus() != null ? req.getStatus() : TaskStatus.TODO)
                .quadrant(req.getQuadrant() != null ? req.getQuadrant() : Quadrant.DO)
                .priority(req.getPriority())
                .note(req.getNote())
                .dueDate(req.getDueDate())
                .dueTime(req.getDueTime())
                .category(req.getCategory())
                .listId(req.getListId())
                .taskOrder(req.getTaskOrder() != null ? req.getTaskOrder() : 0)
                .reminderEnabled(req.getReminderEnabled() != null && req.getReminderEnabled())
                .reminderMinutesBefore(req.getReminderMinutesBefore())
                .build();

        if (task.getStatus() == TaskStatus.DONE) {
            task.setCompletedAt(Instant.now());
        }

        Task saved = taskRepository.save(task);

        if (saved.getStatus() == TaskStatus.DONE) {
            momentumService.recordCompletion(saved.getListId());
        }

        return TaskResponse.from(saved);
    }

    @Transactional
    public TaskResponse updateTask(UUID id, TaskRequest req) {
        Task task = findOrThrow(id);

        if (req.getTitle() != null)    task.setTitle(req.getTitle().trim());
        if (req.getNote() != null)     task.setNote(req.getNote());
        if (req.getDueDate() != null)  task.setDueDate(req.getDueDate());
        if (req.getDueTime() != null)  task.setDueTime(req.getDueTime());
        if (req.getCategory() != null) task.setCategory(req.getCategory());
        if (req.getPriority() != null) task.setPriority(req.getPriority());
        if (req.getQuadrant() != null) task.setQuadrant(req.getQuadrant());
        if (req.getListId() != null)   task.setListId(req.getListId());
        if (req.getTaskOrder() != null) task.setTaskOrder(req.getTaskOrder());
        if (req.getReminderEnabled() != null) task.setReminderEnabled(req.getReminderEnabled());
        if (req.getReminderMinutesBefore() != null) task.setReminderMinutesBefore(req.getReminderMinutesBefore());

        if (req.getStatus() != null) {
            applyStatusTransition(task, req.getStatus());
        }

        return TaskResponse.from(taskRepository.save(task));
    }

    @Transactional
    public TaskResponse updateStatus(UUID id, TaskStatus newStatus) {
        Task task = findOrThrow(id);
        applyStatusTransition(task, newStatus);
        Task saved = taskRepository.save(task);
        if (newStatus == TaskStatus.DONE) {
            momentumService.recordCompletion(saved.getListId());
        }
        return TaskResponse.from(saved);
    }

    @Transactional
    public TaskResponse markComplete(UUID id) {
        Task task = findOrThrow(id);
        task.setStatus(TaskStatus.DONE);
        task.setCompletedAt(Instant.now());
        Task saved = taskRepository.save(task);
        momentumService.recordCompletion(saved.getListId());
        return TaskResponse.from(saved);
    }

    /**
     * PATCH /api/tasks/{id}/quadrant — reprioritize without touching other fields.
     */
    @Transactional
    public TaskResponse reprioritize(UUID id, Quadrant quadrant) {
        Task task = findOrThrow(id);
        task.setQuadrant(quadrant);
        return TaskResponse.from(taskRepository.save(task));
    }

    @Transactional
    public void deleteTask(UUID id) {
        if (!taskRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found: " + id);
        }
        taskRepository.deleteById(id);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private void applyStatusTransition(Task task, TaskStatus newStatus) {
        TaskStatus previous = task.getStatus();
        task.setStatus(newStatus);
        if (newStatus == TaskStatus.DONE && previous != TaskStatus.DONE) {
            task.setCompletedAt(Instant.now());
        } else if (newStatus != TaskStatus.DONE && previous == TaskStatus.DONE) {
            task.setCompletedAt(null);
        }
    }

    private Task findOrThrow(UUID id) {
        return taskRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found: " + id));
    }
}
