/**
 * The bridge between writing a task and the delivery queue.
 *
 * Everything here is called from inside a task request, which sets the one
 * rule the module is built around: **a scheduling problem must never fail the
 * user's save.** Someone editing a task title should not see a 500 because the
 * queue table is briefly unreachable. So every entry point swallows its errors,
 * returns a short description of what it did, and leaves the caller to log it.
 *
 * The cost of that choice is a reminder that silently fails to schedule. It is
 * the right trade: the sweep re-derives nothing, but a task write is cheap to
 * repeat and a lost save is not. `backfillReminders()` exists to close the gap.
 *
 * The other half of the design is that `syncTaskReminder()` is safe to call on
 * *every* task write, unconditionally. It works out what should be scheduled,
 * cancels anything superseded, and enqueues the rest — so callers do not have
 * to reason about whether an edit changed the schedule. A title change plans
 * the same DedupeKey, finds it already queued, and does nothing.
 */
import type { CatalystApp } from './types.ts';
import { enqueue, cancelPendingFor, cancelSupersededFor } from './queue.ts';
import { planTaskReminder, renderReminder, type SchedulableTask } from './schedule.ts';

/** Channels a task reminder is delivered on. */
export const REMINDER_CHANNELS = ['inapp', 'email', 'webpush'];

/** Who the reminder is for, and in which zone their clock runs. */
export interface ReminderContext {
  ownerId: string;
  /** Delivery address. Empty is allowed — the email channel then skips. */
  email: string;
  /** IANA zone name, already validated. See resolveTimeZone(). */
  timeZone: string;
}

/**
 * Picks the zone to interpret a task's due date in.
 *
 * The browser knows its own zone, so the client sends it on the request and we
 * validate it here rather than storing a per-user setting nobody would ever
 * change. An unknown or absent value falls back to DEFAULT_TIMEZONE and then to
 * UTC, which is wrong by a few hours rather than wrong by a day.
 */
export function resolveTimeZone(candidate: unknown): string {
  const named = String(candidate ?? '').trim();
  if (named && isKnownTimeZone(named)) return named;

  const configured = (process.env['DEFAULT_TIMEZONE'] ?? '').trim();
  if (configured && isKnownTimeZone(configured)) return configured;

  return 'UTC';
}

/** True when Intl recognises the zone. The only reliable check available. */
export function isKnownTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export interface SyncResult {
  /** A new queue row was written. */
  enqueued: boolean;
  /** Stale rows for this task that were superseded or withdrawn. */
  cancelled: number;
  /** Present when the sync failed; the task write still succeeded. */
  error?: string;
  /** Short human-readable outcome, for the server log. */
  detail: string;
}

/**
 * Brings the queue in line with a task's current reminder settings.
 *
 * Call on create, update, status change, and completion. The three outcomes:
 *
 *   nothing to schedule  → cancel every pending row for the task
 *   schedule unchanged   → the DedupeKey already exists; enqueue is a no-op
 *   schedule moved       → enqueue the new key, cancel the superseded ones
 *
 * Order matters in the last case. The new row is enqueued BEFORE the old is
 * cancelled, so a crash between the two leaves a duplicate rather than a gap —
 * two reminders is an annoyance, none is the bug this work exists to fix.
 */
export async function syncTaskReminder(
  app: CatalystApp,
  ctx: ReminderContext,
  task: SchedulableTask,
): Promise<SyncResult> {
  try {
    const plan = planTaskReminder(task, ctx.timeZone);

    if (!plan) {
      const cancelled = await cancelPendingFor(app, 'TASK', task.id);
      return {
        enqueued: false,
        cancelled,
        detail: cancelled > 0
          ? `no reminder due; cancelled ${cancelled}`
          : 'no reminder due',
      };
    }

    const { title, body } = renderReminder(task, plan.minutesBefore);

    const enqueued = await enqueue(app, {
      ownerId: ctx.ownerId,
      fireAt: plan.fireAt,
      dedupeKey: plan.dedupeKey,
      kind: 'TASK_REMINDER',
      sourceType: 'TASK',
      sourceId: task.id,
      channels: REMINDER_CHANNELS,
      title,
      body,
      payload: {
        email: ctx.email,
        taskId: task.id,
        dueAt: plan.dueAt,
        minutesBefore: plan.minutesBefore,
      },
    });

    const cancelled = await cancelSupersededFor(app, 'TASK', task.id, [plan.dedupeKey]);

    return {
      enqueued,
      cancelled,
      detail: `${enqueued ? 'queued' : 'already queued'} for ` +
        `${new Date(plan.fireAt).toISOString()}` +
        (cancelled > 0 ? `; superseded ${cancelled}` : ''),
    };
  } catch (e) {
    return {
      enqueued: false,
      cancelled: 0,
      error: describe(e),
      detail: `sync failed: ${describe(e)}`,
    };
  }
}

/**
 * Withdraws every pending reminder for a task.
 *
 * For deletion, where there is no longer a task to re-derive anything from.
 * Completion goes through syncTaskReminder() instead, which reaches the same
 * outcome via `status === 'DONE'` — one code path deciding what is due.
 */
export async function cancelTaskReminders(
  app: CatalystApp,
  taskId: string,
): Promise<SyncResult> {
  try {
    const cancelled = await cancelPendingFor(app, 'TASK', taskId);
    return {
      enqueued: false,
      cancelled,
      detail: cancelled > 0 ? `cancelled ${cancelled}` : 'nothing queued',
    };
  } catch (e) {
    return { enqueued: false, cancelled: 0, error: describe(e), detail: `cancel failed: ${describe(e)}` };
  }
}

/**
 * Queues reminders for tasks that predate the queue, or whose sync failed.
 *
 * Idempotent by construction: every task plans the DedupeKey it would have had
 * all along, so a second run enqueues nothing. That makes it safe to run on a
 * schedule as a self-heal, not just once at migration.
 */
export async function backfillReminders(
  app: CatalystApp,
  ctx: ReminderContext,
  tasks: SchedulableTask[],
): Promise<{ scanned: number; enqueued: number; failed: number; details: string[] }> {
  const out = { scanned: tasks.length, enqueued: 0, failed: 0, details: [] as string[] };

  for (const task of tasks) {
    // Only tasks that actually want a reminder; the rest would each cost a
    // pointless cancel query.
    if (!task.reminderEnabled || !task.dueDate) continue;

    const result = await syncTaskReminder(app, ctx, task);
    if (result.error) {
      out.failed++;
      out.details.push(`${task.id}: ${result.detail}`);
    } else if (result.enqueued) {
      out.enqueued++;
    }
  }

  return out;
}

/** Renders a thrown value usefully; the SDK throws plain objects. */
function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o['code'], o['statusCode'], o['message']]
      .filter((v) => v !== undefined && v !== null)
      .map(String);
    if (parts.length) return parts.join(' | ');
  }
  return String(e);
}
