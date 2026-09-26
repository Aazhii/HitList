package com.hitlist.web;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> api(ApiException exception) {
        return ResponseEntity.status(exception.getStatus()).body(Map.of(
            "error", exception.getError(),
            "message", exception.getMessage()
        ));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> malformed() {
        return ResponseEntity.badRequest().body(Map.of(
            "error", "bad_request",
            "message", "Malformed request body"
        ));
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Map<String, Object>> datastore(DataAccessException exception) {
        return ResponseEntity.status(503).body(Map.of(
            "error", "storage_unavailable",
            "message", "Storage backend unavailable"
        ));
    }
}
