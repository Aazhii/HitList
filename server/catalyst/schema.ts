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
export const VIEWS_TABLE = 'KaizenViews';
export const PROP_DEFS_TABLE = 'KaizenPropDefs';
export const TASK_PROPS_TABLE = 'KaizenTaskProps';
export const TRIAL_FEATURES_TABLE = 'KaizenTrialFeatures';
export const DATABASES_TABLE = 'KaizenDatabases';
export const DB_ROWS_TABLE = 'KaizenDbRows';

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
      // Added after launch, so every row written before them has these empty.
      // The server reads and writes them only once it has confirmed they
      // exist — see ensureTaskLinkColumns — so deploying before
      // `pnpm catalyst:setup` has run cannot break task reads.
      { name: 'SourceNoteId',  type: 'varchar', maxLength: 64,
        note: 'Note a task was added from via the @ menu; empty = not from a note' },
      { name: 'SourceBlockId', type: 'varchar', maxLength: 64,
        note: 'Block inside that note' },
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
      // Added after launch. A rule used to fire once, at OffsetValue before the
      // due instant; it now fires once per step, which is what lets one rule
      // escalate. Empty on rules written before this column, and read back
      // through stepsForRule() as the single step those columns described —
      // see server/automations/steps.ts.
      { name: 'OffsetSteps', type: 'varchar', maxLength: 255,
        note: 'Signed minutes from the due instant, comma separated: -60,-5,0,30' },
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

  // Saved views over tasks: a named filter, sort, layout and list scope.
  // Filtering happens in the browser; this only stores the definitions. The
  // filter is one JSON value because its fields follow the filter bar and
  // nothing queries inside it — see server/views.ts.
  {
    name: VIEWS_TABLE,
    columns: [
      { name: 'ViewId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'Name', type: 'varchar', maxLength: 100, mandatory: true },
      { name: 'ViewLayout', type: 'varchar', maxLength: 16, note: 'list | matrix' },
      { name: 'ScopeListId', type: 'varchar', maxLength: 64, note: 'A list the view opens; empty = whichever is open' },
      { name: 'FilterJson', type: 'text', note: 'src/lib/taskFilters FilterState, normalised on write' },
      { name: 'DisplayJson', type: 'text',
        note: 'Table columns: which are hidden, their order and widths. Added after launch — guarded by hasOptionalColumn.' },
      { name: 'ShowDone', type: 'boolean' },
      { name: 'ViewOrder', type: 'int' },
      { name: 'CreatedAt', type: 'bigint' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },

  // Custom task fields — a user's own field definitions. Separate tables rather
  // than columns on KaizenTasks, because fields are per user and change at
  // runtime. See server/fields.ts.
  {
    name: PROP_DEFS_TABLE,
    columns: [
      { name: 'DefId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      // Added after launch, so the server reads and writes it only once it has
      // seen it. Empty means a task field, which is every field written so far.
      { name: 'DatabaseId', type: 'varchar', maxLength: 64,
        note: "The database this field belongs to; '' = the task fields" },
      { name: 'Name', type: 'varchar', maxLength: 100, mandatory: true },
      { name: 'FieldKind', type: 'varchar', maxLength: 16,
        note: 'select | multi | number | date | checkbox | text. Fixed once created.' },
      { name: 'OptionsJson', type: 'text', note: '[{id, label, color}] for select and multi' },
      { name: 'DefOrder', type: 'int' },
      { name: 'ShowOnCard', type: 'boolean' },
      { name: 'CreatedAt', type: 'bigint' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },

  // One task's value for one field. Stored as text and parsed by the field's
  // kind: whether date and double columns round-trip has not been verified.
  {
    name: TASK_PROPS_TABLE,
    columns: [
      { name: 'PropId', type: 'varchar', maxLength: 64, mandatory: true, unique: true,
        note: 'Hash of task + field, so one value per slot is enforced by the constraint' },
      OWNER_COLUMN,
      { name: 'TaskId', type: 'varchar', maxLength: 64, mandatory: true },
      { name: 'DefId', type: 'varchar', maxLength: 64, mandatory: true },
      { name: 'ValueText', type: 'text' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },

  // Databases: records that are not tasks, with their own fields. Tasks stay as
  // they are — they are simply the database the app ships with. Field
  // definitions and values are the existing KaizenPropDefs / KaizenTaskProps,
  // so every field kind, filter and cell editor works on these the day they
  // exist. See server/databases.ts.
  {
    name: DATABASES_TABLE,
    columns: [
      { name: 'DatabaseId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'Name', type: 'varchar', maxLength: 100, mandatory: true },
      { name: 'Icon', type: 'varchar', maxLength: 16 },
      { name: 'DbOrder', type: 'int' },
      { name: 'CreatedAt', type: 'bigint' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },

  // One record in a database. Title is its only built-in column, as a task's
  // title is; everything else is a custom field.
  {
    name: DB_ROWS_TABLE,
    columns: [
      // NOT RowId: column names are case-insensitive, so RowId resolves to
      // Catalyst's own ROWID — setup reports "already exists" and creates
      // nothing, and SELECT RowId quietly returns the internal id. Same trap as
      // Priority, which is why tasks use TaskPriority.
      { name: 'RecordId', type: 'varchar', maxLength: 64, mandatory: true, unique: true },
      OWNER_COLUMN,
      { name: 'DatabaseId', type: 'varchar', maxLength: 64, mandatory: true },
      { name: 'Title', type: 'varchar', maxLength: 255 },
      { name: 'RowOrder', type: 'int' },
      { name: 'CreatedAt', type: 'bigint' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },

  // App-wide switches for features that cost money to keep running. The one
  // table with no OwnerId: a row turns a feature on or off for everyone. Edited
  // by hand in the Data Store console; the server re-reads it within a minute.
  // See server/trialFeatures.ts.
  {
    name: TRIAL_FEATURES_TABLE,
    columns: [
      { name: 'FeatureKey', type: 'varchar', maxLength: 64, mandatory: true, unique: true,
        note: 'notifications | automations' },
      { name: 'Enabled', type: 'boolean', note: 'true | false. A missing row counts as true.' },
      { name: 'UpdatedAt', type: 'bigint' },
    ],
  },
];

export const TABLE_NAMES = SCHEMA.map((t) => t.name);
