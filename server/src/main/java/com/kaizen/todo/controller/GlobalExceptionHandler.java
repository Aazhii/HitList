package com.kaizen.todo.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Centralised error handling for all REST controllers.
 *
 * Returns a consistent JSON error envelope:
 * {
 *   "timestamp": "2024-...",
 *   "status": 400,
 *   "error": "Bad Request",
 *   "message": "...",
 *   "fieldErrors": { "title": "must not be blank" }   // validation only
 * }
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    // ---------------------------------------------------------------
    // Bean validation failures (@Valid on request body)
    // ---------------------------------------------------------------

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(
            MethodArgumentNotValidException ex) {

        Map<String, String> fieldErrors = new HashMap<>();
        for (FieldError fe : ex.getBindingResult().getFieldErrors()) {
            fieldErrors.put(fe.getField(), fe.getDefaultMessage());
        }

        return buildResponse(HttpStatus.BAD_REQUEST,
                "Validation failed", fieldErrors);
    }

    // ---------------------------------------------------------------
    // ResponseStatusException (404, 400 thrown from service layer)
    // ---------------------------------------------------------------

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(
            ResponseStatusException ex) {

        return buildResponse(
                HttpStatus.valueOf(ex.getStatusCode().value()),
                ex.getReason() != null ? ex.getReason() : ex.getMessage(),
                null);
    }

    // ---------------------------------------------------------------
    // Catch-all for unexpected errors
    // ---------------------------------------------------------------

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        return buildResponse(HttpStatus.INTERNAL_SERVER_ERROR,
                "An unexpected error occurred", null);
    }

    // ---------------------------------------------------------------
    // Helper
    // ---------------------------------------------------------------

    private ResponseEntity<Map<String, Object>> buildResponse(
            HttpStatus status, String message, Map<String, String> fieldErrors) {

        Map<String, Object> body = new HashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status", status.value());
        body.put("error", status.getReasonPhrase());
        body.put("message", message);
        if (fieldErrors != null && !fieldErrors.isEmpty()) {
            body.put("fieldErrors", fieldErrors);
        }
        return ResponseEntity.status(status).body(body);
    }
}
