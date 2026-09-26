package com.hitlist.storage;

import java.util.Map;

public final class StorageTables {
    public static final String TASKS = "KaizenTasks";
    public static final String LISTS = "KaizenLists";
    public static final String NOTES = "KaizenNotes";
    public static final String QUEUE = "KaizenNotificationQueue";
    public static final String RULES = "KaizenAutomationRules";
    public static final String NOTIFICATIONS = "KaizenNotifications";
    public static final String RUNS = "KaizenAutomationRuns";
    public static final String VIEWS = "KaizenViews";
    public static final String FIELD_DEFS = "KaizenPropDefs";
    public static final String FIELD_VALUES = "KaizenTaskProps";
    public static final String DATABASES = "KaizenDatabases";
    public static final String DATABASE_ROWS = "KaizenDbRows";
    public static final String CALENDAR_CONNECTIONS = "KaizenZohoCalendarConnections";
    public static final String MIGRATION_MARKERS = "KaizenMigrationMarkers";

    private static final Map<String, String> PRIMARY_KEYS = Map.ofEntries(
        Map.entry(TASKS, "TaskId"),
        Map.entry(LISTS, "ListId"),
        Map.entry(NOTES, "NoteId"),
        Map.entry(QUEUE, "QueueId"),
        Map.entry(RULES, "RuleId"),
        Map.entry(NOTIFICATIONS, "NotificationId"),
        Map.entry(RUNS, "RunId"),
        Map.entry(VIEWS, "ViewId"),
        Map.entry(FIELD_DEFS, "DefId"),
        Map.entry(FIELD_VALUES, "PropId"),
        Map.entry(DATABASES, "DatabaseId"),
        Map.entry(DATABASE_ROWS, "RecordId"),
        Map.entry(CALENDAR_CONNECTIONS, "ConnectionId"),
        Map.entry(MIGRATION_MARKERS, "MarkerId")
    );

    private StorageTables() {
    }

    public static String primaryKey(String table) {
        String key = PRIMARY_KEYS.get(table);
        if (key == null) {
            throw new IllegalArgumentException("Unknown storage table: " + table);
        }
        return key;
    }

    public static boolean isKnown(String table) {
        return PRIMARY_KEYS.containsKey(table);
    }
}
