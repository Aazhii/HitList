package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.ListService;
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
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/lists")
public class ListController {
    private final ListService lists;
    private final OwnerResolver owners;

    public ListController(ListService lists, OwnerResolver owners) {
        this.lists = lists;
        this.owners = owners;
    }

    @GetMapping
    List<Map<String, Object>> list(HttpServletRequest request) {
        return lists.list(owners.owner(request));
    }

    @GetMapping("/{id}")
    Map<String, Object> get(@PathVariable String id, HttpServletRequest request) {
        return lists.get(owners.owner(request), id);
    }

    @PostMapping
    ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(lists.create(owners.owner(request), body));
    }

    @PutMapping("/{id}")
    Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        return lists.update(owners.owner(request), id, body);
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@PathVariable String id, HttpServletRequest request) {
        lists.delete(owners.owner(request), id);
        return ResponseEntity.noContent().build();
    }
}
