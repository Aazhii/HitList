package com.kaizen.todo.service;

import com.kaizen.todo.dto.AutomationRuleRequest;
import com.kaizen.todo.dto.AutomationRuleResponse;
import com.kaizen.todo.model.AutomationRule;
import com.kaizen.todo.repository.AutomationRuleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AutomationRuleService {

    private final AutomationRuleRepository ruleRepo;

    // ── Queries ──────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public List<AutomationRuleResponse> getAllRules() {
        return ruleRepo.findAllByOrderByCreatedAtDesc()
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public AutomationRuleResponse getRuleById(UUID id) {
        return toResponse(findOrThrow(id));
    }

    @Transactional(readOnly = true)
    public List<AutomationRule> getActiveRules() {
        return ruleRepo.findByStatusOrderByCreatedAtDesc("active");
    }

    // ── Mutations ────────────────────────────────────────────────────────────

    @Transactional
    public AutomationRuleResponse createRule(AutomationRuleRequest req) {
        AutomationRule rule = AutomationRule.builder()
                .name(req.getName())
                .description(req.getDescription())
                .taskId(req.getTaskId())
                .taskTitle(req.getTaskTitle())
                .triggerType(req.getTriggerType())
                .status(req.getStatus())
                .urgency(req.getUrgency())
                .notifyInApp(req.isNotifyInApp())
                .notifyBrowser(req.isNotifyBrowser())
                .reminderOffsetJson(req.getReminderOffsetJson())
                .recurrenceJson(req.getRecurrenceJson())
                .build();
        return toResponse(ruleRepo.save(rule));
    }

    @Transactional
    public AutomationRuleResponse updateRule(UUID id, AutomationRuleRequest req) {
        AutomationRule rule = findOrThrow(id);
        rule.setName(req.getName());
        rule.setDescription(req.getDescription());
        rule.setTaskId(req.getTaskId());
        rule.setTaskTitle(req.getTaskTitle());
        rule.setTriggerType(req.getTriggerType());
        rule.setStatus(req.getStatus());
        rule.setUrgency(req.getUrgency());
        rule.setNotifyInApp(req.isNotifyInApp());
        rule.setNotifyBrowser(req.isNotifyBrowser());
        rule.setReminderOffsetJson(req.getReminderOffsetJson());
        rule.setRecurrenceJson(req.getRecurrenceJson());
        return toResponse(ruleRepo.save(rule));
    }

    @Transactional
    public AutomationRuleResponse toggleStatus(UUID id) {
        AutomationRule rule = findOrThrow(id);
        String next = "active".equals(rule.getStatus()) ? "paused" : "active";
        rule.setStatus(next);
        return toResponse(ruleRepo.save(rule));
    }

    @Transactional
    public void deleteRule(UUID id) {
        ruleRepo.deleteById(id);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    AutomationRule findOrThrow(UUID id) {
        return ruleRepo.findById(id)
                .orElseThrow(() -> new jakarta.persistence.EntityNotFoundException(
                        "AutomationRule not found: " + id));
    }

    AutomationRuleResponse toResponse(AutomationRule r) {
        return AutomationRuleResponse.builder()
                .id(r.getId())
                .name(r.getName())
                .description(r.getDescription())
                .taskId(r.getTaskId())
                .taskTitle(r.getTaskTitle())
                .triggerType(r.getTriggerType())
                .status(r.getStatus())
                .urgency(r.getUrgency())
                .notifyInApp(r.isNotifyInApp())
                .notifyBrowser(r.isNotifyBrowser())
                .reminderOffsetJson(r.getReminderOffsetJson())
                .recurrenceJson(r.getRecurrenceJson())
                .lastTriggeredAt(r.getLastTriggeredAt())
                .nextTriggerAt(r.getNextTriggerAt())
                .createdAt(r.getCreatedAt())
                .updatedAt(r.getUpdatedAt())
                .build();
    }
}
