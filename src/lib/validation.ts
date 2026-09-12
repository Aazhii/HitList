/**
 * validation.ts — Lightweight input validators for Catalyst DataStore writes.
 *
 * All validators throw a typed ValidationError on failure so callers can
 * catch and surface the message in the UI (toast / error state).
 * They return void on success so they can be called inline before any write.
 */

// ── Typed error ───────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertNonEmpty(value: unknown, fieldName: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} must not be empty.`);
  }
}

function assertMaxLength(value: string, max: number, fieldName: string): void {
  if (value.trim().length > max) {
    throw new ValidationError(`${fieldName} must be ${max} characters or fewer.`);
  }
}

// ── Task validators ───────────────────────────────────────────────────────────

/** Validates a task title before create or update. */
export function validateTaskTitle(title: unknown): void {
  assertNonEmpty(title, 'Task title');
  assertMaxLength(title as string, 500, 'Task title');
}

/** Validates a task note (optional field — only validates length when present). */
export function validateTaskNote(note: unknown): void {
  if (note === null || note === undefined || note === '') return;
  if (typeof note !== 'string') throw new ValidationError('Task note must be a string.');
  assertMaxLength(note, 5000, 'Task note');
}

/** Validates a due date string (YYYY-MM-DD) when provided. */
export function validateDueDate(dueDate: unknown): void {
  if (!dueDate) return;
  if (typeof dueDate !== 'string') throw new ValidationError('Due date must be a string.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new ValidationError('Due date must be in YYYY-MM-DD format.');
  }
}

/** Validates a due time string (HH:MM) when provided. */
export function validateDueTime(dueTime: unknown): void {
  if (!dueTime) return;
  if (typeof dueTime !== 'string') throw new ValidationError('Due time must be a string.');
  if (!/^\d{2}:\d{2}$/.test(dueTime)) {
    throw new ValidationError('Due time must be in HH:MM format.');
  }
}

/** Full task create/update validation. */
export function validateTaskWrite(req: {
  title?: unknown;
  note?: unknown;
  dueDate?: unknown;
  dueTime?: unknown;
}): void {
  if (req.title !== undefined) validateTaskTitle(req.title);
  if (req.note !== undefined) validateTaskNote(req.note);
  if (req.dueDate !== undefined) validateDueDate(req.dueDate);
  if (req.dueTime !== undefined) validateDueTime(req.dueTime);
}

// ── List validators ───────────────────────────────────────────────────────────

/** Validates a list name before create or update. */
export function validateListName(name: unknown): void {
  assertNonEmpty(name, 'List name');
  assertMaxLength(name as string, 200, 'List name');
}

/** Full list create/update validation. */
export function validateListWrite(req: { name?: unknown }): void {
  if (req.name !== undefined) validateListName(req.name);
}

// ── User validators ───────────────────────────────────────────────────────────

/** Validates a Catalyst user_id before writing to the Users table. */
export function validateUserId(userId: unknown): void {
  assertNonEmpty(userId, 'User ID');
  assertMaxLength(userId as string, 100, 'User ID');
}

/** Validates an email address before writing to the Users table. */
export function validateEmail(email: unknown): void {
  if (!email) return; // email is optional in some flows
  if (typeof email !== 'string') throw new ValidationError('Email must be a string.');
  if (email.length > 320) throw new ValidationError('Email must be 320 characters or fewer.');
  if (!email.includes('@')) throw new ValidationError('Email must be a valid email address.');
}
