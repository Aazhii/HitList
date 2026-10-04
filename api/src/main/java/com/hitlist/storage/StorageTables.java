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
    public static final String FAVORITES = "KaizenFavorites";
    public static final String RECENTS = "KaizenRecents";
    public static final String MIGRATION_MARKERS = "KaizenMigrationMarkers";
    public static final String CLIQ_COMMAND_RECEIPTS = "KaizenCliqCommandReceipts";
    /** Shared workspaces this device holds a copy of (one row, stored under the workspace's own id). */
    public static final String WORKSPACE_INFO = "KaizenWorkspaceInfo";
    /** Changes to a shared workspace made on this device and not yet accepted by the cloud. */
    public static final String SYNC_OUTBOX = "KaizenSyncOutbox";
    public static final String SYNC_FRAGMENTS = "KaizenSyncFragments";
    public static final String SHARED_SOURCES = "KaizenSharedSources";

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
        Map.entry(FAVORITES, "MarkId"),
        Map.entry(RECENTS, "MarkId"),
        Map.entry(MIGRATION_MARKERS, "MarkerId"),
        Map.entry(CLIQ_COMMAND_RECEIPTS, "CommandKey"),
        Map.entry(WORKSPACE_INFO, "WorkspaceId"),
        Map.entry(SYNC_OUTBOX, "OpId"),
        Map.entry(SYNC_FRAGMENTS, "FragmentId"),
        Map.entry(SHARED_SOURCES, "SourceKey")
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
