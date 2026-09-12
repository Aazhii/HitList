package com.kaizen.todo.dto;

import com.kaizen.todo.model.KaizenList;
import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

/**
 * Outbound DTO for KaizenList responses.
 * Mirrors the frontend {@code KaizenList} interface.
 */
@Data
@Builder
public class KaizenListResponse {

    private UUID id;
    private String name;
    private String color;
    private int listOrder;
    private Instant createdAt;
    private Instant updatedAt;

    public static KaizenListResponse from(KaizenList list) {
        return KaizenListResponse.builder()
                .id(list.getId())
                .name(list.getName())
                .color(list.getColor())
                .listOrder(list.getListOrder())
                .createdAt(list.getCreatedAt())
                .updatedAt(list.getUpdatedAt())
                .build();
    }
}
