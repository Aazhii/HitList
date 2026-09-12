package com.kaizen.todo.dto;

import com.kaizen.todo.model.Priority;
import com.kaizen.todo.model.Quadrant;
import com.kaizen.todo.model.TaskStatus;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Inbound DTO for creating or updating a Task.
 * All fields except {@code title} are optional so the same DTO
 * works for both full PUT updates and partial PATCH-style updates.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TaskRequest {

    /** Required on create; optional on update. */
    @Size(min = 1, max = 500, message = "Title must be between 1 and 500 characters")
    private String title;

    private TaskStatus status;

    private Quadrant quadrant;

    private Priority priority;

    @Size(max = 2000, message = "Note must be 2000 characters or fewer")
    private String note;

    private LocalDate dueDate;

    /** HH:MM 24-hour format. */
    @Size(max = 5)
    private String dueTime;

    @Size(max = 100)
    private String category;

    /** UUID of the parent KaizenList. */
    private UUID listId;

    /** Display order within the list/quadrant. */
    private Integer taskOrder;

    /** Whether a reminder is active. */
    private Boolean reminderEnabled;

    /** Minutes before due time to fire the reminder (5 / 15 / 30 / 60). */
    private Integer reminderMinutesBefore;
}
