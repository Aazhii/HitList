package com.kaizen.todo.service;

import com.kaizen.todo.dto.AutomationRunResponse;
import com.kaizen.todo.model.AutomationRun;
import com.kaizen.todo.model.AutomationRule;
import com.kaizen.todo.repository.AutomationRunRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AutomationRunService {

    private final AutomationRunRepository runRepo;
    private final AutomationRuleService ruleService;

    @Transactional(readOnly = true)
    public List<AutomationRunResponse> getRecent() {
        return runRepo.findTop20ByOrderByTriggeredAtDesc()
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<AutomationRunResponse> getByRuleId(UUID ruleId) {
        return runRepo.findByRuleIdOrderByTriggeredAtDesc(ruleId)
                .stream().map(this::toResponse).toList();
    }

    /** Manual trigger — always fires regardless of schedule. */
    @Transactional
    public AutomationRunResponse triggerManually(UUID ruleId) {
        AutomationRule rule = ruleService.findOrThrow(ruleId);
        AutomationRun run = AutomationRun.builder()
                .ruleId(ruleId)
                .ruleName(rule.getName())
                .triggeredAt(Instant.now())
                .status("success")
                .message("Manually triggered: " + rule.getName())
                .triggerSource("manual")
                .build();
        rule.setLastTriggeredAt(run.getTriggeredAt());
        // persist both
        runRepo.save(run);
        return toResponse(run);
    }

    /** Called by the scheduler — records a run for a rule. */
    @Transactional
    public AutomationRun recordScheduledRun(AutomationRule rule, String status, String message) {
        AutomationRun run = AutomationRun.builder()
                .ruleId(rule.getId())
                .ruleName(rule.getName())
                .triggeredAt(Instant.now())
                .status(status)
                .message(message)
                .triggerSource("scheduler")
                .build();
        rule.setLastTriggeredAt(run.getTriggeredAt());
        return runRepo.save(run);
    }

    private AutomationRunResponse toResponse(AutomationRun r) {
        return AutomationRunResponse.builder()
                .id(r.getId())
                .ruleId(r.getRuleId())
                .ruleName(r.getRuleName())
                .triggeredAt(r.getTriggeredAt())
                .status(r.getStatus())
                .message(r.getMessage())
                .triggerSource(r.getTriggerSource())
                .build();
    }
}
