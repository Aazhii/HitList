package com.kaizen.todo.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.*;

/**
 * Inbound DTO for creating or updating a KaizenList.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KaizenListRequest {

    @NotBlank(message = "List name must not be blank")
    @Size(max = 100, message = "List name must be 100 characters or fewer")
    private String name;

    /**
     * Tailwind color token key (e.g. "emerald", "blue", "rose").
     * Defaults to "emerald" when absent.
     */
    @Size(max = 30)
    private String color;

    /** Display order for sidebar sorting. */
    private Integer listOrder;
}
