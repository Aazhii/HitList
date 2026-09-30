package com.hitlist.domain;

import com.hitlist.storage.StorageTables;
import com.hitlist.web.ApiException;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Favourites and recents: which pages (a list, a note or a database) an owner has starred, and
 * which they opened last. Both are plain rows in the generic store, keyed by kind and page id, so
 * starring twice or visiting twice is one row, and nothing here touches the pages themselves.
 */
@Service
public class PageMarksService {
    static final Set<String> KINDS = Set.of("list", "note", "database");
    /** Recents keep this many; the oldest fall off. */
    static final int MAX_RECENTS = 20;
    static final int MAX_FAVORITES = 200;

    private final EntityRepository repository;

    public PageMarksService(EntityRepository repository) {
        this.repository = repository;
    }

    public List<Map<String, Object>> favorites(String owner) {
        return repository.list(StorageTables.FAVORITES, owner).stream()
            .sorted(Comparator.comparingLong(row -> Values.number(row.get("CreatedAt"), 0)))
            .map(row -> api(row, "CreatedAt", "createdAt"))
            .toList();
    }

    public Map<String, Object> addFavorite(String owner, String kind, String pageId) {
        String key = key(kind, pageId);
        return repository.find(StorageTables.FAVORITES, owner, key).map(row -> api(row, "CreatedAt", "createdAt")).orElseGet(() -> {
            if (repository.list(StorageTables.FAVORITES, owner).size() >= MAX_FAVORITES) {
                throw ApiException.invalid("you already have " + MAX_FAVORITES + " favorites");
            }
            Map<String, Object> row = row(key, kind, pageId);
            row.put("CreatedAt", System.currentTimeMillis());
            repository.insert(StorageTables.FAVORITES, owner, row);
            return api(row, "CreatedAt", "createdAt");
        });
    }

    public void removeFavorite(String owner, String kind, String pageId) {
        repository.delete(StorageTables.FAVORITES, owner, key(kind, pageId));
    }

    public List<Map<String, Object>> recents(String owner) {
        return repository.list(StorageTables.RECENTS, owner).stream()
            .sorted(Comparator.comparingLong((Map<String, Object> row) -> Values.number(row.get("VisitedAt"), 0)).reversed())
            .map(row -> api(row, "VisitedAt", "visitedAt"))
            .toList();
    }

    /** Opening a page puts it at the top; the list is trimmed to the newest {@value #MAX_RECENTS}. */
    public Map<String, Object> visit(String owner, String kind, String pageId) {
        String key = key(kind, pageId);
        Map<String, Object> row = row(key, kind, pageId);
        // Strictly after the newest visit, so two opens in the same millisecond still have an order.
        long newest = repository.list(StorageTables.RECENTS, owner).stream()
            .mapToLong(r -> Values.number(r.get("VisitedAt"), 0)).max().orElse(0);
        row.put("VisitedAt", Math.max(System.currentTimeMillis(), newest + 1));
        if (repository.find(StorageTables.RECENTS, owner, key).isPresent()) {
            repository.replace(StorageTables.RECENTS, owner, key, row);
        } else {
            repository.insert(StorageTables.RECENTS, owner, row);
        }
        List<Map<String, Object>> all = repository.list(StorageTables.RECENTS, owner).stream()
            .sorted(Comparator.comparingLong((Map<String, Object> r) -> Values.number(r.get("VisitedAt"), 0)).reversed())
            .toList();
        for (Map<String, Object> stale : all.subList(Math.min(MAX_RECENTS, all.size()), all.size())) {
            repository.delete(StorageTables.RECENTS, owner, EntityRepository.text(stale.get("MarkId")));
        }
        return api(row, "VisitedAt", "visitedAt");
    }

    public void removeRecent(String owner, String kind, String pageId) {
        repository.delete(StorageTables.RECENTS, owner, key(kind, pageId));
    }

    private static String key(String kind, String pageId) {
        if (!KINDS.contains(kind)) throw ApiException.invalid("kind must be one of list, note, database");
        Values.id(pageId);
        return kind + "_" + pageId;
    }

    private static Map<String, Object> row(String key, String kind, String pageId) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("MarkId", key);
        row.put("Kind", kind);
        row.put("PageId", pageId);
        return row;
    }

    private static Map<String, Object> api(Map<String, Object> row, String timeField, String timeName) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", EntityRepository.text(row.get("Kind")));
        out.put("id", EntityRepository.text(row.get("PageId")));
        out.put(timeName, Values.number(row.get(timeField), 0));
        return out;
    }
}
