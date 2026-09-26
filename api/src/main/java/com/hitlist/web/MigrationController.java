package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.RemoteExportImportService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/migrations")
public class MigrationController {
    private final RemoteExportImportService imports;
    private final OwnerResolver owners;

    public MigrationController(RemoteExportImportService imports, OwnerResolver owners) {
        this.imports = imports;
        this.owners = owners;
    }

    @PostMapping("/remote-export")
    ResponseEntity<Map<String, Object>> importRemoteExport(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(imports.importRemoteExport(owners.owner(request), body));
    }
}
