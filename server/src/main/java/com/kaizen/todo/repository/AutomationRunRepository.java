package com.kaizen.todo.repository;

import com.kaizen.todo.model.AutomationRun;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface AutomationRunRepository extends JpaRepository<AutomationRun, UUID> {

    List<AutomationRun> findTop20ByOrderByTriggeredAtDesc();

    List<AutomationRun> findByRuleIdOrderByTriggeredAtDesc(UUID ruleId);

    List<AutomationRun> findTop5ByRuleIdOrderByTriggeredAtDesc(UUID ruleId);
}
