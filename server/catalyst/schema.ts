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

export const SCHEMA: TableSpec[] = [
  {
    name: TASKS_TABLE,
    columns: [
      { name: 'TaskId', type: 'varchar', maxLength: 64, mandatory: true, unique: true,
        note: 'Client-facing id (UUID). ROWID stays internal to Catalyst.' },
      OWNER_COLUMN,
      { name: 'Title',     type: 'varchar', maxLength: 500, mandatory: true },
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
      { name: 'Name',      type: 'varchar', maxLength: 500, mandatory: true },
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
      { name: 'Title',      type: 'varchar', maxLength: 500 },
      { name: 'BlocksJson', type: 'text', note: 'Serialised editor blocks; 10k limit applies' },
      { name: 'Emoji',      type: 'varchar', maxLength: 16 },
      { name: 'Pinned',     type: 'boolean' },
      { name: 'CreatedAt',  type: 'bigint' },
      { name: 'UpdatedAt',  type: 'bigint' },
    ],
  },
];

export const TABLE_NAMES = SCHEMA.map((t) => t.name);
