package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.WorkspaceService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class WorkspaceController {
    private final WorkspaceService workspace;
    private final OwnerResolver owners;

    public WorkspaceController(WorkspaceService workspace, OwnerResolver owners) {
        this.workspace = workspace;
        this.owners = owners;
    }

    @GetMapping("/views")
    List<Map<String, Object>> views(HttpServletRequest request) {
        return workspace.views(owners.owner(request));
    }

    @PostMapping("/views")
    ResponseEntity<Map<String, Object>> createView(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workspace.createView(owners.owner(request), body));
    }

    @PutMapping("/views/{id}")
    Map<String, Object> updateView(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        return workspace.updateView(owners.owner(request), id, body);
    }

    @DeleteMapping("/views/{id}")
    ResponseEntity<Void> deleteView(@PathVariable String id, HttpServletRequest request) {
        workspace.deleteView(owners.owner(request), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/fields")
    List<Map<String, Object>> fields(@RequestParam(required = false) String databaseId, HttpServletRequest request) {
        return workspace.fields(owners.owner(request), databaseId == null ? "" : databaseId);
    }

    @PostMapping("/fields")
    ResponseEntity<Map<String, Object>> createField(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workspace.createField(owners.owner(request), body));
    }

    @PutMapping("/fields/{id}")
    Map<String, Object> updateField(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        return workspace.updateField(owners.owner(request), id, body);
    }

    @DeleteMapping("/fields/{id}")
    ResponseEntity<Void> deleteField(@PathVariable String id, HttpServletRequest request) {
        workspace.deleteField(owners.owner(request), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/field-values")
    List<Map<String, Object>> fieldValues(HttpServletRequest request) {
        return workspace.taskValues(owners.owner(request));
    }

    @PutMapping("/tasks/{taskId}/fields/{fieldId}")
    Map<String, Object> setTaskValue(
        @PathVariable String taskId, @PathVariable String fieldId, @RequestBody Map<String, Object> body, HttpServletRequest request
    ) {
        return workspace.setTaskValue(owners.owner(request), taskId, fieldId, body.get("value"));
    }

    @GetMapping("/databases")
    List<Map<String, Object>> databases(HttpServletRequest request) {
        return workspace.databases(owners.owner(request));
    }

    @PostMapping("/databases")
    ResponseEntity<Map<String, Object>> createDatabase(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workspace.createDatabase(owners.owner(request), body));
    }

    @PutMapping("/databases/{id}")
    Map<String, Object> updateDatabase(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        return workspace.updateDatabase(owners.owner(request), id, body);
    }

    @PostMapping("/databases/{id}/delete")
    Map<String, Object> deleteDatabase(@PathVariable String id, HttpServletRequest request) {
        return Map.of("ok", true, "recordsRemoved", workspace.deleteDatabase(owners.owner(request), id));
    }

    @GetMapping("/databases/{id}/rows")
    List<Map<String, Object>> databaseRows(@PathVariable String id, HttpServletRequest request) {
        return workspace.databaseRows(owners.owner(request), id);
    }

    @PostMapping("/databases/{id}/rows")
    ResponseEntity<Map<String, Object>> createDatabaseRow(
        @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request
    ) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workspace.createDatabaseRow(owners.owner(request), id, body));
    }

    @PutMapping("/databases/rows/{recordId}")
    Map<String, Object> updateDatabaseRow(
        @PathVariable String recordId, @RequestBody Map<String, Object> body, HttpServletRequest request
    ) {
        return workspace.updateDatabaseRow(owners.owner(request), recordId, body);
    }

    @DeleteMapping("/databases/rows/{recordId}")
    ResponseEntity<Void> deleteDatabaseRow(@PathVariable String recordId, HttpServletRequest request) {
        workspace.deleteDatabaseRow(owners.owner(request), recordId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/databases/{id}/field-values")
    List<Map<String, Object>> databaseFieldValues(@PathVariable String id, HttpServletRequest request) {
        return workspace.recordValues(owners.owner(request), id);
    }

    @PutMapping("/databases/rows/{recordId}/fields/{fieldId}")
    Map<String, Object> setDatabaseFieldValue(
        @PathVariable String recordId, @PathVariable String fieldId, @RequestBody Map<String, Object> body, HttpServletRequest request
    ) {
        return workspace.setRecordValue(owners.owner(request), recordId, fieldId, body.get("value"));
    }

    @GetMapping("/calendar")
    Map<String, Object> calendar(HttpServletRequest request) {
        return workspace.calendar(owners.owner(request));
    }

    @GetMapping("/notifications")
    List<Map<String, Object>> notifications(HttpServletRequest request) {
        return workspace.notifications(owners.owner(request));
    }

    @PatchMapping("/notifications/{id}/read")
    ResponseEntity<Void> readNotification(@PathVariable String id, HttpServletRequest request) {
        workspace.readNotification(owners.owner(request), id);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/notifications/read-all")
    Map<String, Object> readAllNotifications(HttpServletRequest request) {
        return Map.of("updated", workspace.readAllNotifications(owners.owner(request)));
    }

    @DeleteMapping("/notifications/{id}")
    ResponseEntity<Void> deleteNotification(@PathVariable String id, HttpServletRequest request) {
        workspace.deleteNotification(owners.owner(request), id);
        return ResponseEntity.noContent().build();
    }
}
