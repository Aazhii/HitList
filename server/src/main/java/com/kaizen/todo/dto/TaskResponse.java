package com.kaizen.todo.dto;

import com.kaizen.todo.model.Priority;
import com.kaizen.todo.model.Quadrant;
import com.kaizen.todo.model.Task;
import com.kaizen.todo.model.TaskStatus;
import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Outbound DTO for Task responses.
 * Mirrors the frontend {@code Todo} interface in src/types/todo.ts.
 */
@Data
@Builder
public class TaskResponse {

    private UUID id;
    private String title;
    private TaskStatus status;
    private Quadrant quadrant;
    private Priority priority;
    private String note;
    private LocalDate dueDate;
    private String dueTime;
    private String category;
    private UUID listId;
    private int taskOrder;
    private boolean reminderEnabled;
    private Integer reminderMinutesBefore;
    private Instant completedAt;
    private Instant createdAt;
    private Instant updatedAt;

    public static TaskResponse from(Task task) {
        return TaskResponse.builder()
                .id(task.getId())
                .title(task.getTitle())
                .status(task.getStatus())
                .quadrant(task.getQuadrant())
                .priority(task.getPriority())
                .note(task.getNote())
                .dueDate(task.getDueDate())
                .dueTime(task.getDueTime())
                .category(task.getCategory())
                .listId(task.getListId())
                .taskOrder(task.getTaskOrder())
                .reminderEnabled(task.isReminderEnabled())
                .reminderMinutesBefore(task.getReminderMinutesBefore())
                .completedAt(task.getCompletedAt())
                .createdAt(task.getCreatedAt())
                .updatedAt(task.getUpdatedAt())
                .build();
    }
}
