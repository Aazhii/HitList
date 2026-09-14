/**
 * The Catalyst Data Store schema for HitList.
 *
 * One definition, used by the setup script to create tables and columns and by
 * the server's startup probe to verify them. Previously the schema lived in
 * three places that had already drifted: a doc comment at the top of
 * notes-server.ts, a hardcoded column list used by the runtime column
 * provisioner, and the browser Web SDK client, which used the column name
 * TaskPriority where the server used Priority.
 *
 * Column types are deliberate. The old provisioner created every column as
 * `text` because it had no type information, which meant numeric ordering and
 * timestamps were compared as strings.
 *
 * Catalyst types (see data-types docs):
 *   varchar  max 255        text     max 10,000
 *
 * varchar is clamped to 255 SILENTLY: declaring 500 is accepted without error
 * and the column is created at 255. Query the column list if the length
 * matters — see docs/catalyst/03-datastore.md.
 *   int      10 digits      bigint   19 digits (epoch ms fits)
 *   boolean  true/false
 *
 * Note: the SDK returns every value as a string regardless of column type, so
 * readers must still coerce. The types matter for storage, ordering and
 * validation, not for the shape of what comes back.
 */

export interface ColumnSpec {
  name: string;
  type: 'varchar' | 'text' | 'int' | 'bigint' | 'boolean';
  maxLength?: number;
  mandatory?: boolean;
  unique?: boolean;
  /** Why this column exists, when it is not obvious from the name. */
  note?: string;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
}

/** Every row is scoped to its owner; this column is what makes that possible. */
const OWNER_COLUMN: ColumnSpec = {
  name: 'OwnerId',
  type: 'varchar',
  maxLength: 64,
  mandatory: true,
  note: 'Catalyst user_id — every query filters on this',
};

export const TASKS_TABLE = 'KaizenTasks';
export const LISTS_TABLE = 'KaizenLists';
export const NOTES_TABLE = 'KaizenNotes';
export const QUEUE_TABLE = 'KaizenNotificationQueue';
export const RULES_TABLE = 'KaizenAutomationRules';
export const INBOX_TABLE = 'KaizenNotifications';
export const RUNS_TABLE = 'KaizenAutomationRuns';

export const SCHEMA: TableSpec[] = [
  {
    name: TASKS_TABLE,
    columns: [
      { name: 'TaskId', type: 'varchar', maxLength: 64, mandatory: true, unique: true,
        note: 'Client-facing id (UUID). ROWID stays internal to Catalyst.' },
      OWNER_COLUMN,
      { name: 'Title',     type: 'varchar', maxLength: 255, mandatory: true,
        note: 'Catalyst clamps varchar at 255 — declaring more is accepted and ignored' },
      { name: 'Status',    type: 'varchar', maxLength: 16, note: 'TODO | IN_PROGRESS | DONE' },
      { name: 'Quadrant',  type: 'varchar', maxLength: 16, note: 'DO | SCHEDULE | DELEGATE | ELIMINATE' },
      // Named TaskPriority, not Priority: Catalyst rejects "Priority" as a
      // reserved keyword with INVALID_OPERATION. The API field stays `priority`.
      { name: 'TaskPriority', type: 'varchar', maxLength: 16, note: 'LOW | MEDIUM | HIGH, or empty' },
      { name: 'Note',      type: 'text' },
      { name: 'DueDate',   type: 'varchar', maxLength: 10, note: 'YYYY-MM-DD' },
      { name: 'DueTime',   type: 'varchar', maxLength: 5,  note: 'HH:MM' },
      { name: 'Category',  type: 'varchar', maxLength: 100 },
      { name: 'ListId',    type: 'varchar', maxLength: 64 },
      { name: 'TaskOrder', type: 'int', note: 'Sort position. Was text, so it sorted lexically.' },
      { name: 'ReminderEnabled',       type: 'boolean' },
      { name: 'ReminderMinutesBefore', type: 'int' },
      { name: 'CompletedAt', type: 'bigint', note: 'epoch ms, 0 = not completed' },
      { name: 'CreatedAt',   type: 'bigint', note: 'epoch ms' },
      { name: 'UpdatedAt',   type: 'bigint', note: 'epoch ms' },
    ],
  },
  {
    name: LISTS_TABLE,
    columns: [
      { name: 'ListId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'Name',      type: 'varchar', maxLength: 255, mandatory: true },
      { name: 'Color',     type: 'varchar', maxLength: 32 },
      { name: 'ListOrder', type: 'int' },
      { name: 'CreatedAt', type: 'bigint' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },
  {
    name: NOTES_TABLE,
    columns: [
      { name: 'NoteId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      // Notes had no owner column at all, so every note was visible to every user.
      OWNER_COLUMN,
      { name: 'Title',      type: 'varchar', maxLength: 255 },
      { name: 'BlocksJson', type: 'text', note: 'Serialised editor blocks; 10k limit applies' },
      { name: 'Emoji',      type: 'varchar', maxLength: 16 },
      { name: 'Pinned',     type: 'boolean' },
      { name: 'CreatedAt',  type: 'bigint' },
      { name: 'UpdatedAt',  type: 'bigint' },
    ],
  },

  // ── Scheduling ─────────────────────────────────────────────────────────────
  //
  // The outbox. Every delivery, whatever produced it, becomes a row here.
  //
  // The design decision worth understanding: we materialise what is DUE rather
  // than scanning what MIGHT be due. A sweep that evaluates every task on every
  // tick reads the whole table forever, and its cost grows with the database
  // rather than with the work. Querying FireAt instead returns nothing at all
  // on a quiet tick, however many tasks exist — which is what keeps the tick
  // cheap and what lets it scale.
  {
    name: QUEUE_TABLE,
    columns: [
      { name: 'QueueId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'FireAt', type: 'bigint', mandatory: true,
        note: 'Absolute epoch ms. The tick queries this — timezone is resolved at enqueue.' },
      { name: 'Status', type: 'varchar', maxLength: 16, mandatory: true,
        note: 'PENDING | SENDING | SENT | FAILED | CANCELLED' },
      { name: 'DedupeKey', type: 'varchar', maxLength: 200, mandatory: true, unique: true,
        note: 'Idempotency. Carries the due time, so re-scheduling yields a new key.' },
      { name: 'Kind', type: 'varchar', maxLength: 32, note: 'TASK_REMINDER | AUTOMATION | DIGEST' },
      { name: 'SourceType', type: 'varchar', maxLength: 16, note: 'TASK | RULE' },
      { name: 'SourceId', type: 'varchar', maxLength: 64 },
      { name: 'Channels', type: 'varchar', maxLength: 64, note: 'Comma list: email,webpush,inapp' },
      { name: 'Title', type: 'varchar', maxLength: 255,
        note: 'Rendered at enqueue, so a tick does no formatting work' },
      { name: 'Body', type: 'text' },
      { name: 'Payload', type: 'text', note: 'JSON for deep-linking' },
      { name: 'ClaimToken', type: 'varchar', maxLength: 64,
        note: 'Optimistic lock. Catalyst has no conditional UPDATE and reports no ' +
              'affected-row count, so a claimer writes its token and re-reads to ' +
              'confirm it won. Without this, two sweeps both deliver.' },
      { name: 'AttemptCount', type: 'int' },
      { name: 'LastError', type: 'text' },
      { name: 'SentAt', type: 'bigint' },
      { name: 'CreatedAt', type: 'bigint' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },

  // The user's automation rules. NextTriggerAt is the planning index: the tick
  // asks for rules that are due rather than walking every rule a user owns.
  {
    name: RULES_TABLE,
    columns: [
      { name: 'RuleId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'Name', type: 'varchar', maxLength: 255, mandatory: true },
      { name: 'Description', type: 'text' },
      { name: 'TaskId', type: 'varchar', maxLength: 64, note: 'Empty = applies to all tasks' },
      { name: 'TriggerType', type: 'varchar', maxLength: 24,
        note: 'due-date | overdue | recurring | status-change | daily-digest' },
      { name: 'RuleStatus', type: 'varchar', maxLength: 16,
        note: 'active | paused | draft. Not "Status" — kept distinct from the queue column.' },
      { name: 'Urgency', type: 'varchar', maxLength: 16, note: 'low | medium | high | critical' },
      { name: 'OffsetValue', type: 'int' },
      { name: 'OffsetUnit', type: 'varchar', maxLength: 16, note: 'minutes | hours | days' },
      { name: 'RecurrenceFreq', type: 'varchar', maxLength: 16,
        note: 'daily | weekdays | weekly | monthly' },
      { name: 'RecurrenceTime', type: 'varchar', maxLength: 5, note: 'HH:MM, local to the owner' },
      { name: 'RecurrenceDayOfWeek', type: 'int', note: '0=Sun … 6=Sat' },
      { name: 'RecurrenceDayOfMonth', type: 'int', note: '1–31' },
      { name: 'NotifyInApp', type: 'boolean' },
      { name: 'NotifyBrowser', type: 'boolean' },
      { name: 'NotifyEmail', type: 'boolean' },
      // The tick runs as the cron, with no user session, so it can resolve
      // neither the owner's zone nor their address. Both are captured here
      // when the rule is written from a signed-in request — the same trick the
      // queue uses, where a reminder resolves its timezone once at enqueue.
      { name: 'OwnerTimezone', type: 'varchar', maxLength: 64,
        note: 'IANA zone the RecurrenceTime is local to' },
      { name: 'OwnerEmail', type: 'varchar', maxLength: 255,
        note: 'Delivery address; empty means the email channel skips' },
      { name: 'LastTriggeredAt', type: 'bigint' },
      { name: 'NextTriggerAt', type: 'bigint', note: 'The planning index for the tick' },
      { name: 'CreatedAt', type: 'bigint' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },

  // What the in-app bell reads. Previously it was fed fabricated records.
  {
    name: INBOX_TABLE,
    columns: [
      { name: 'NotificationId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'Title', type: 'varchar', maxLength: 255 },
      { name: 'Body', type: 'text' },
      { name: 'Kind', type: 'varchar', maxLength: 32 },
      { name: 'SourceType', type: 'varchar', maxLength: 16 },
      { name: 'SourceId', type: 'varchar', maxLength: 64 },
      { name: 'Payload', type: 'text' },
      { name: 'ReadAt', type: 'bigint', note: '0 or absent = unread' },
      { name: 'CreatedAt', type: 'bigint' },
    ],
  },

  // Audit trail — what fired, when, and whether delivery worked.
  {
    name: RUNS_TABLE,
    columns: [
      { name: 'RunId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'RuleId', type: 'varchar', maxLength: 64 },
      // Denormalised deliberately: the audit trail has to stay readable after
      // the rule it describes is deleted, which is exactly when someone is
      // most likely to be reading it.
      { name: 'RuleName', type: 'varchar', maxLength: 255 },
      { name: 'TriggeredAt', type: 'bigint' },
      { name: 'RunStatus', type: 'varchar', maxLength: 16, note: 'SUCCESS | FAILED | SKIPPED' },
      { name: 'TriggerSource', type: 'varchar', maxLength: 16, note: 'scheduler | manual' },
      { name: 'Detail', type: 'text' },
      { name: 'Channels', type: 'varchar', maxLength: 64 },
    ],
  },
];

export const TABLE_NAMES = SCHEMA.map((t) => t.name);
