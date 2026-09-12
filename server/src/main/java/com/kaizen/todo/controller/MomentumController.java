package com.kaizen.todo.controller;

import com.kaizen.todo.service.MomentumService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * GET /api/stats/momentum          — global momentum stats
 * GET /api/stats/momentum?listId=  — per-list momentum stats
 */
@RestController
@RequestMapping("/api/stats")
@RequiredArgsConstructor
public class MomentumController {

    private final MomentumService momentumService;

    @GetMapping("/momentum")
    public ResponseEntity<Map<String, Object>> getMomentum(
            @RequestParam(required = false) UUID listId) {
        return ResponseEntity.ok(momentumService.getMomentumStats(listId));
    }
}
