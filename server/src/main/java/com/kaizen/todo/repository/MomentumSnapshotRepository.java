package com.kaizen.todo.repository;

import com.kaizen.todo.model.MomentumSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MomentumSnapshotRepository extends JpaRepository<MomentumSnapshot, UUID> {

    Optional<MomentumSnapshot> findBySnapshotDateAndListId(LocalDate date, UUID listId);

    Optional<MomentumSnapshot> findBySnapshotDateAndListIdIsNull(LocalDate date);

    /** Latest snapshot for a given list (or global when listId is null). */
    @Query("SELECT s FROM MomentumSnapshot s WHERE s.listId = :listId ORDER BY s.snapshotDate DESC LIMIT 1")
    Optional<MomentumSnapshot> findLatestByListId(@Param("listId") UUID listId);

    @Query("SELECT s FROM MomentumSnapshot s WHERE s.listId IS NULL ORDER BY s.snapshotDate DESC LIMIT 1")
    Optional<MomentumSnapshot> findLatestGlobal();
}
