package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.EntityRepository;
import com.hitlist.storage.StorageTables;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PlatformController {
    private final EntityRepository repository;
    private final OwnerResolver owners;

    public PlatformController(EntityRepository repository, OwnerResolver owners) {
        this.repository = repository;
        this.owners = owners;
    }

    @GetMapping("/health")
    Map<String, Object> health() {
        return Map.of("ok", true);
    }

    @RequestMapping(value = "/api/health", method = RequestMethod.HEAD)
    ResponseEntity<Void> apiHealthHead() {
        return ResponseEntity.ok().build();
    }

    @GetMapping("/api/health")
    Map<String, Object> apiHealth() {
        return Map.of("ok", true, "ts", System.currentTimeMillis(), "backend", repository.mode());
    }

    @GetMapping("/api/setup")
    Map<String, Object> setup() {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("mode", repository.mode());
        response.put("message", "PostgreSQL-backed storage is configured.");
        response.put("tables", java.util.List.of("hitlist_storage_rows"));
        return response;
    }

    @GetMapping("/api/trial-features")
    Map<String, Object> trialFeatures(HttpServletRequest request) {
        owners.owner(request);
        return Map.of("notifications", false, "automations", false);
    }
}
