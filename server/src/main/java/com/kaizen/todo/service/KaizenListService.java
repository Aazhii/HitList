package com.kaizen.todo.service;

import com.kaizen.todo.dto.KaizenListRequest;
import com.kaizen.todo.dto.KaizenListResponse;
import com.kaizen.todo.model.KaizenList;
import com.kaizen.todo.repository.KaizenListRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class KaizenListService {

    private final KaizenListRepository listRepository;

    public List<KaizenListResponse> getAllLists() {
        return listRepository.findAllByOrderByListOrderAscCreatedAtAsc()
                .stream().map(KaizenListResponse::from).collect(Collectors.toList());
    }

    public KaizenListResponse getListById(UUID id) {
        return KaizenListResponse.from(findOrThrow(id));
    }

    @Transactional
    public KaizenListResponse createList(KaizenListRequest req) {
        KaizenList list = KaizenList.builder()
                .name(req.getName())
                .color(req.getColor() != null ? req.getColor() : "emerald")
                .listOrder(req.getListOrder() != null ? req.getListOrder() : 0)
                .build();
        return KaizenListResponse.from(listRepository.save(list));
    }

    @Transactional
    public KaizenListResponse updateList(UUID id, KaizenListRequest req) {
        KaizenList list = findOrThrow(id);
        if (req.getName() != null) list.setName(req.getName());
        if (req.getColor() != null) list.setColor(req.getColor());
        if (req.getListOrder() != null) list.setListOrder(req.getListOrder());
        return KaizenListResponse.from(listRepository.save(list));
    }

    @Transactional
    public void deleteList(UUID id) {
        if (!listRepository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "List not found: " + id);
        }
        listRepository.deleteById(id);
    }

    private KaizenList findOrThrow(UUID id) {
        return listRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "List not found: " + id));
    }
}
