package com.kaizen.todo.controller;

import com.kaizen.todo.dto.AutomationRuleRequest;
import com.kaizen.todo.dto.AutomationRuleResponse;
import com.kaizen.todo.service.AutomationRuleService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * GET    /api/automation-rules          — list all rules
 * GET    /api/automation-rules/{id}     — single rule
 * POST   /api/automation-rules          — create rule
 * PUT    /api/automation-rules/{id}     — update rule
 * PATCH  /api/automation-rules/{id}/toggle — toggle active/paused
 * DELETE /api/automation-rules/{id}     — delete rule
 */
@RestController
@RequestMapping("/api/automation-rules")
@RequiredArgsConstructor
public class AutomationRuleController {

    private final AutomationRuleService ruleService;

    @GetMapping
    public ResponseEntity<List<AutomationRuleResponse>> getAll() {
        return ResponseEntity.ok(ruleService.getAllRules());
    }

    @GetMapping("/{id}")
    public ResponseEntity<AutomationRuleResponse> getOne(@PathVariable UUID id) {
        return ResponseEntity.ok(ruleService.getRuleById(id));
    }

    @PostMapping
    public ResponseEntity<AutomationRuleResponse> create(@Valid @RequestBody AutomationRuleRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ruleService.createRule(req));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AutomationRuleResponse> update(
            @PathVariable UUID id,
            @Valid @RequestBody AutomationRuleRequest req) {
        return ResponseEntity.ok(ruleService.updateRule(id, req));
    }

    @PatchMapping("/{id}/toggle")
    public ResponseEntity<AutomationRuleResponse> toggle(@PathVariable UUID id) {
        return ResponseEntity.ok(ruleService.toggleStatus(id));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        ruleService.deleteRule(id);
        return ResponseEntity.noContent().build();
    }
}
