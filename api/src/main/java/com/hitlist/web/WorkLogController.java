package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.WorkLogService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The progress log behind the Monday update, per owner. */
@RestController
@RequestMapping("/api/worklog")
public class WorkLogController {
    private final WorkLogService log;
    private final OwnerResolver owners;

    public WorkLogController(WorkLogService log, OwnerResolver owners) {
        this.log = log;
        this.owners = owners;
    }

    @GetMapping
    List<Map<String, Object>> list(@RequestParam(defaultValue = "0") long from, @RequestParam(defaultValue = "9223372036854775807") long to, HttpServletRequest request) {
        return log.list(owners.owner(request), from, to);
    }

    @PostMapping
    ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(log.create(owners.owner(request), body));
    }

    @PutMapping("/{id}")
    Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        return log.update(owners.owner(request), id, body);
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@PathVariable String id, HttpServletRequest request) {
        log.delete(owners.owner(request), id);
        return ResponseEntity.noContent().build();
    }
}
