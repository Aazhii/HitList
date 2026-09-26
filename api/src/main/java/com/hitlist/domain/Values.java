package com.hitlist.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hitlist.web.ApiException;
import java.time.Instant;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

public final class Values {
    public static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final TypeReference<LinkedHashMap<String, Object>> MAP_TYPE = new TypeReference<>() { };

    private Values() {
    }

    public static void id(String id) {
        if (id == null || !SAFE_ID.matcher(id).matches()) {
            throw ApiException.invalid("id must match " + SAFE_ID);
        }
    }

    public static String required(Map<String, Object> body, String field, int max) {
        Object raw = body.get(field);
        if (!(raw instanceof String value) || value.trim().isEmpty() || value.trim().length() > max) {
            throw ApiException.invalid(field + " must be a non-empty string of at most " + max + " characters");
        }
        return value.trim();
    }

    public static String optional(Map<String, Object> body, String field, int max, String fallback) {
        if (!body.containsKey(field) || body.get(field) == null) {
            return fallback;
        }
        Object raw = body.get(field);
        if (!(raw instanceof String value) || value.length() > max) {
            throw ApiException.invalid(field + " must be a string of at most " + max + " characters");
        }
        return value;
    }

    public static String enumValue(Map<String, Object> body, String field, Set<String> allowed, String fallback) {
        if (!body.containsKey(field) || body.get(field) == null || "".equals(body.get(field))) {
            return fallback;
        }
        if (!(body.get(field) instanceof String raw)) {
            throw ApiException.invalid(field + " must be a string");
        }
        String value = raw.trim().toUpperCase(Locale.ROOT);
        if (!allowed.contains(value)) {
            throw ApiException.invalid(field + " must be one of " + String.join(", ", allowed));
        }
        return value;
    }

    public static long optionalLong(Map<String, Object> body, String field, long fallback, long minimum) {
        if (!body.containsKey(field) || body.get(field) == null || "".equals(body.get(field))) {
            return fallback;
        }
        Object raw = body.get(field);
        if (!(raw instanceof Number number) || !Double.isFinite(number.doubleValue()) || number.longValue() < minimum) {
            throw ApiException.invalid(field + " must be a finite number no less than " + minimum);
        }
        return number.longValue();
    }

    public static long optionalTimestamp(Map<String, Object> body, String field, long fallback) {
        if (!body.containsKey(field) || body.get(field) == null || "".equals(body.get(field))) {
            return fallback;
        }
        Object raw = body.get(field);
        if (raw instanceof Number number && Double.isFinite(number.doubleValue()) && number.longValue() >= 0) {
            return number.longValue();
        }
        if (raw instanceof String text) {
            try {
                return Instant.parse(text).toEpochMilli();
            } catch (DateTimeParseException exception) {
                // Fall through to the public validation error below.
            }
        }
        throw ApiException.invalid(field + " must be an ISO-8601 instant or non-negative epoch milliseconds");
    }

    public static boolean optionalBoolean(Map<String, Object> body, String field, boolean fallback) {
        if (!body.containsKey(field) || body.get(field) == null || "".equals(body.get(field))) {
            return fallback;
        }
        Object raw = body.get(field);
        if (raw instanceof Boolean value) {
            return value;
        }
        if ("true".equals(raw)) {
            return true;
        }
        if ("false".equals(raw)) {
            return false;
        }
        throw ApiException.invalid(field + " must be a boolean");
    }

    public static String date(Map<String, Object> body, String field, String fallback) {
        String value = optional(body, field, 10, fallback);
        if (value.isEmpty()) {
            return value;
        }
        try {
            return LocalDate.parse(value).toString();
        } catch (DateTimeParseException exception) {
            throw ApiException.invalid(field + " must be a date in YYYY-MM-DD form");
        }
    }

    public static String time(Map<String, Object> body, String field, String fallback) {
        String value = optional(body, field, 5, fallback);
        if (value.isEmpty()) {
            return value;
        }
        try {
            return LocalTime.parse(value).toString();
        } catch (DateTimeParseException exception) {
            throw ApiException.invalid(field + " must be a time in HH:MM form");
        }
    }

    public static String iso(long epochMillis) {
        return epochMillis == 0 ? null : Instant.ofEpochMilli(epochMillis).toString();
    }

    public static long number(Object value, long fallback) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    public static boolean bool(Object value) {
        return value instanceof Boolean flag ? flag : "true".equalsIgnoreCase(String.valueOf(value));
    }

    public static Map<String, Object> jsonMap(ObjectMapper objectMapper, Object value, Map<String, Object> fallback) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> output = new LinkedHashMap<>();
            map.forEach((key, mapValue) -> output.put(String.valueOf(key), mapValue));
            return output;
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                return objectMapper.readValue(text, MAP_TYPE);
            } catch (JsonProcessingException exception) {
                return fallback;
            }
        }
        return fallback;
    }

    public static List<Object> jsonList(ObjectMapper objectMapper, Object value) {
        if (value instanceof List<?> list) {
            return new ArrayList<>(list);
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                JsonNode node = objectMapper.readTree(text);
                if (node.isArray()) {
                    return objectMapper.convertValue(node, new TypeReference<List<Object>>() { });
                }
            } catch (JsonProcessingException exception) {
                return List.of();
            }
        }
        return List.of();
    }

    public static ZoneId zone(String value) {
        try {
            return value == null || value.isBlank() ? ZoneId.of("UTC") : ZoneId.of(value);
        } catch (DateTimeException exception) {
            return ZoneId.of("UTC");
        }
    }
}
