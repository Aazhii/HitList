package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.WorkspaceBackupService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Export and import of a whole workspace (P6.4). */
@RestController
@RequestMapping("/api/backup")
public class BackupController {
    private final WorkspaceBackupService backups;
    private final OwnerResolver owners;

    public BackupController(WorkspaceBackupService backups, OwnerResolver owners) {
        this.backups = backups;
        this.owners = owners;
    }

    @GetMapping
    Map<String, Object> export(HttpServletRequest request) {
        return backups.export(owners.owner(request));
    }

    @PostMapping
    Map<String, Object> importBackup(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return backups.importBackup(owners.owner(request), body);
    }
}
