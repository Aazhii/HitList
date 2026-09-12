package com.kaizen.todo.controller;

import com.kaizen.todo.dto.AutomationRunResponse;
import com.kaizen.todo.service.AutomationRunService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * GET  /api/automation-runs/recent          — last 20 runs across all rules
 * GET  /api/automation-runs?ruleId={id}     — runs for a specific rule
 * POST /api/automation-runs/trigger/{ruleId} — manual trigger
 */
@RestController
@RequestMapping("/api/automation-runs")
@RequiredArgsConstructor
public class AutomationRunController {

    private final AutomationRunService runService;

    @GetMapping("/recent")
    public ResponseEntity<List<AutomationRunResponse>> getRecent() {
        return ResponseEntity.ok(runService.getRecent());
    }

    @GetMapping
    public ResponseEntity<List<AutomationRunResponse>> getByRule(@RequestParam UUID ruleId) {
        return ResponseEntity.ok(runService.getByRuleId(ruleId));
    }

    @PostMapping("/trigger/{ruleId}")
    public ResponseEntity<AutomationRunResponse> trigger(@PathVariable UUID ruleId) {
        return ResponseEntity.ok(runService.triggerManually(ruleId));
    }
}
