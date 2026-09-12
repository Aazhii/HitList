package com.kaizen.todo.controller;

import com.kaizen.todo.dto.NoteRequest;
import com.kaizen.todo.dto.NoteResponse;
import com.kaizen.todo.service.NoteService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * GET    /api/notes          — list all notes (pinned first, then by updatedAt desc)
 * GET    /api/notes/{id}     — single note
 * POST   /api/notes          — create note
 * PUT    /api/notes/{id}     — full update
 * DELETE /api/notes/{id}     — delete note
 */
@RestController
@RequestMapping("/api/notes")
@RequiredArgsConstructor
public class NoteController {

    private final NoteService noteService;

    @GetMapping
    public ResponseEntity<List<NoteResponse>> getAllNotes() {
        return ResponseEntity.ok(noteService.getAllNotes());
    }

    @GetMapping("/{id}")
    public ResponseEntity<NoteResponse> getNote(@PathVariable UUID id) {
        return ResponseEntity.ok(noteService.getNoteById(id));
    }

    @PostMapping
    public ResponseEntity<NoteResponse> createNote(@RequestBody NoteRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(noteService.createNote(req));
    }

    @PutMapping("/{id}")
    public ResponseEntity<NoteResponse> updateNote(
            @PathVariable UUID id,
            @RequestBody NoteRequest req) {
        return ResponseEntity.ok(noteService.updateNote(id, req));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteNote(@PathVariable UUID id) {
        noteService.deleteNote(id);
        return ResponseEntity.noContent().build();
    }
}
