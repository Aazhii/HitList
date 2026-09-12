package com.kaizen.todo.controller;

import com.kaizen.todo.dto.KaizenListRequest;
import com.kaizen.todo.dto.KaizenListResponse;
import com.kaizen.todo.service.KaizenListService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for workspace list management.
 *
 * GET    /api/lists          — all lists ordered by listOrder
 * GET    /api/lists/{id}     — single list
 * POST   /api/lists          — create list
 * PUT    /api/lists/{id}     — update list (name / color / order)
 * DELETE /api/lists/{id}     — delete list (tasks are NOT cascade-deleted)
 */
@RestController
@RequestMapping("/api/lists")
@RequiredArgsConstructor
public class KaizenListController {

    private final KaizenListService listService;

    @GetMapping
    public ResponseEntity<List<KaizenListResponse>> getAllLists() {
        return ResponseEntity.ok(listService.getAllLists());
    }

    @GetMapping("/{id}")
    public ResponseEntity<KaizenListResponse> getList(@PathVariable UUID id) {
        return ResponseEntity.ok(listService.getListById(id));
    }

    @PostMapping
    public ResponseEntity<KaizenListResponse> createList(@Valid @RequestBody KaizenListRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(listService.createList(req));
    }

    @PutMapping("/{id}")
    public ResponseEntity<KaizenListResponse> updateList(
            @PathVariable UUID id,
            @Valid @RequestBody KaizenListRequest req) {
        return ResponseEntity.ok(listService.updateList(id, req));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteList(@PathVariable UUID id) {
        listService.deleteList(id);
        return ResponseEntity.noContent().build();
    }
}
