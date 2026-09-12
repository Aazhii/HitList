package com.kaizen.todo.service;

import com.kaizen.todo.model.MomentumSnapshot;
import com.kaizen.todo.model.TaskStatus;
import com.kaizen.todo.repository.MomentumSnapshotRepository;
import com.kaizen.todo.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MomentumService {

    private final MomentumSnapshotRepository snapshotRepo;
    private final TaskRepository taskRepo;

    /**
     * Returns live momentum stats for a list (or global when listId is null).
     * Stats are computed from the tasks table so they are always fresh.
     */
    public Map<String, Object> getMomentumStats(UUID listId) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        Instant startOfToday = today.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant startOfTomorrow = today.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();

        long todayCompleted = listId == null
                ? taskRepo.countByStatusAndCompletedAtBetween(TaskStatus.DONE, startOfToday, startOfTomorrow)
                : taskRepo.countByListIdAndStatusAndCompletedAtBetween(listId, TaskStatus.DONE, startOfToday, startOfTomorrow);

        long totalCompleted = listId == null
                ? taskRepo.countByStatus(TaskStatus.DONE)
                : taskRepo.countByListIdAndStatus(listId, TaskStatus.DONE);

        // Streak: look at the latest snapshot and extend if today has completions
        int streak = computeStreak(listId, today, todayCompleted > 0);

        return Map.of(
                "streak", streak,
                "totalCompleted", totalCompleted,
                "todayCompleted", todayCompleted,
                "listId", listId != null ? listId.toString() : "global",
                "asOf", Instant.now().toString()
        );
    }

    /**
     * Called after a task is marked complete to upsert today's snapshot.
     */
    @Transactional
    public void recordCompletion(UUID listId) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        Instant startOfToday = today.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant startOfTomorrow = today.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();

        long todayCount = listId == null
                ? taskRepo.countByStatusAndCompletedAtBetween(TaskStatus.DONE, startOfToday, startOfTomorrow)
                : taskRepo.countByListIdAndStatusAndCompletedAtBetween(listId, TaskStatus.DONE, startOfToday, startOfTomorrow);

        long totalCount = listId == null
                ? taskRepo.countByStatus(TaskStatus.DONE)
                : taskRepo.countByListIdAndStatus(listId, TaskStatus.DONE);

        int streak = computeStreak(listId, today, true);

        Optional<MomentumSnapshot> existing = listId == null
                ? snapshotRepo.findBySnapshotDateAndListIdIsNull(today)
                : snapshotRepo.findBySnapshotDateAndListId(today, listId);

        MomentumSnapshot snap = existing.orElseGet(() -> MomentumSnapshot.builder()
                .snapshotDate(today)
                .listId(listId)
                .build());

        snap.setStreak(streak);
        snap.setTotalCompleted((int) totalCount);
        snap.setTodayCompleted((int) todayCount);
        snapshotRepo.save(snap);
    }

    private int computeStreak(UUID listId, LocalDate today, boolean todayHasCompletion) {
        // Find the most recent snapshot before today
        Optional<MomentumSnapshot> latest = listId == null
                ? snapshotRepo.findLatestGlobal()
                : snapshotRepo.findLatestByListId(listId);

        if (latest.isEmpty()) {
            return todayHasCompletion ? 1 : 0;
        }

        MomentumSnapshot snap = latest.get();
        LocalDate snapDate = snap.getSnapshotDate();

        if (snapDate.equals(today)) {
            // Same day — return existing streak (already updated by recordCompletion)
            return snap.getStreak();
        } else if (snapDate.equals(today.minusDays(1))) {
            // Yesterday had activity — extend streak if today also has completions
            return todayHasCompletion ? snap.getStreak() + 1 : snap.getStreak();
        } else {
            // Gap in days — streak resets
            return todayHasCompletion ? 1 : 0;
        }
    }
}
