package com.kaizen.todo.service;

import com.kaizen.todo.dto.NoteRequest;
import com.kaizen.todo.dto.NoteResponse;
import com.kaizen.todo.model.Note;
import com.kaizen.todo.repository.NoteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class NoteService {

    private final NoteRepository noteRepository;

    public List<NoteResponse> getAllNotes() {
        return noteRepository.findAllByOrderByPinnedDescUpdatedAtDesc()
                .stream()
                .map(NoteResponse::from)
                .collect(Collectors.toList());
    }

    public NoteResponse getNoteById(UUID id) {
        return NoteResponse.from(findOrThrow(id));
    }

    public NoteResponse createNote(NoteRequest req) {
        Note note = Note.builder()
                .title(req.getTitle() != null ? req.getTitle() : "Untitled")
                .blocksJson(req.getBlocksJson())
                .emoji(req.getEmoji())
                .pinned(req.getPinned() != null && req.getPinned())
                .createdAt(req.getCreatedAt() != null ? Instant.ofEpochMilli(req.getCreatedAt()) : Instant.now())
                .updatedAt(req.getUpdatedAt() != null ? Instant.ofEpochMilli(req.getUpdatedAt()) : Instant.now())
                .build();
        return NoteResponse.from(noteRepository.save(note));
    }

    public NoteResponse updateNote(UUID id, NoteRequest req) {
        Note note = findOrThrow(id);
        if (req.getTitle() != null)     note.setTitle(req.getTitle());
        if (req.getBlocksJson() != null) note.setBlocksJson(req.getBlocksJson());
        if (req.getEmoji() != null)     note.setEmoji(req.getEmoji());
        if (req.getPinned() != null)    note.setPinned(req.getPinned());
        note.setUpdatedAt(Instant.now());
        return NoteResponse.from(noteRepository.save(note));
    }

    public void deleteNote(UUID id) {
        if (!noteRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Note not found: " + id);
        }
        noteRepository.deleteById(id);
    }

    private Note findOrThrow(UUID id) {
        return noteRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Note not found: " + id));
    }
}
