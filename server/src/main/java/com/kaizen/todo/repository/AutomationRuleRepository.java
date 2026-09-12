package com.kaizen.todo.repository;

import com.kaizen.todo.model.AutomationRule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface AutomationRuleRepository extends JpaRepository<AutomationRule, UUID> {

    List<AutomationRule> findAllByOrderByCreatedAtDesc();

    List<AutomationRule> findByStatusOrderByCreatedAtDesc(String status);
}
