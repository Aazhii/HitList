package com.kaizen.todo.repository;

import com.kaizen.todo.model.Task;
import com.kaizen.todo.model.TaskStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Repository
public interface TaskRepository extends JpaRepository<Task, UUID> {

    // ── List-scoped queries ──────────────────────────────────────────────────

    List<Task> findByListIdOrderByTaskOrderAscCreatedAtAsc(UUID listId);

    List<Task> findByListIdAndStatusOrderByTaskOrderAscCreatedAtAsc(UUID listId, TaskStatus status);

    // ── Global queries ───────────────────────────────────────────────────────

    List<Task> findAllByOrderByTaskOrderAscCreatedAtAsc();

    List<Task> findByStatusOrderByCompletedAtDesc(TaskStatus status);

    // ── Today's history ──────────────────────────────────────────────────────

    @Query("SELECT t FROM Task t WHERE t.status = 'DONE' AND t.completedAt >= :start AND t.completedAt < :end ORDER BY t.completedAt DESC")
    List<Task> findCompletedBetween(@Param("start") Instant start, @Param("end") Instant end);

    @Query("SELECT t FROM Task t WHERE t.listId = :listId AND t.status = 'DONE' AND t.completedAt >= :start AND t.completedAt < :end ORDER BY t.completedAt DESC")
    List<Task> findCompletedBetweenByList(@Param("listId") UUID listId, @Param("start") Instant start, @Param("end") Instant end);

    // ── Due-date queries (for reminder scheduling infrastructure) ────────────

    List<Task> findByDueDateAndStatusNot(LocalDate dueDate, TaskStatus status);

    // ── Count queries for momentum analytics ────────────────────────────────

    long countByStatus(TaskStatus status);

    long countByListIdAndStatus(UUID listId, TaskStatus status);

    long countByStatusAndCompletedAtBetween(TaskStatus status, Instant start, Instant end);

    long countByListIdAndStatusAndCompletedAtBetween(UUID listId, TaskStatus status, Instant start, Instant end);
}
