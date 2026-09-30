package com.hitlist.web;

import com.hitlist.auth.OwnerResolver;
import com.hitlist.domain.PageMarksService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Favourites (starred pages) and recents (last opened), per owner. */
@RestController
@RequestMapping("/api")
public class PageMarksController {
    private final PageMarksService marks;
    private final OwnerResolver owners;

    public PageMarksController(PageMarksService marks, OwnerResolver owners) {
        this.marks = marks;
        this.owners = owners;
    }

    @GetMapping("/favorites")
    List<Map<String, Object>> favorites(HttpServletRequest request) {
        return marks.favorites(owners.owner(request));
    }

    @PutMapping("/favorites/{kind}/{id}")
    Map<String, Object> addFavorite(@PathVariable String kind, @PathVariable String id, HttpServletRequest request) {
        return marks.addFavorite(owners.owner(request), kind, id);
    }

    @DeleteMapping("/favorites/{kind}/{id}")
    ResponseEntity<Void> removeFavorite(@PathVariable String kind, @PathVariable String id, HttpServletRequest request) {
        marks.removeFavorite(owners.owner(request), kind, id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/recents")
    List<Map<String, Object>> recents(HttpServletRequest request) {
        return marks.recents(owners.owner(request));
    }

    @PostMapping("/recents/{kind}/{id}")
    Map<String, Object> visit(@PathVariable String kind, @PathVariable String id, HttpServletRequest request) {
        return marks.visit(owners.owner(request), kind, id);
    }

    @DeleteMapping("/recents/{kind}/{id}")
    ResponseEntity<Void> removeRecent(@PathVariable String kind, @PathVariable String id, HttpServletRequest request) {
        marks.removeRecent(owners.owner(request), kind, id);
        return ResponseEntity.noContent().build();
    }
}
