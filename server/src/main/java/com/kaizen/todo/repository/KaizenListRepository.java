package com.kaizen.todo.repository;

import com.kaizen.todo.model.KaizenList;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface KaizenListRepository extends JpaRepository<KaizenList, UUID> {

    /** All lists ordered by display order ascending, then creation date. */
    List<KaizenList> findAllByOrderByListOrderAscCreatedAtAsc();
}
