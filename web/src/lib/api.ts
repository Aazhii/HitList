/**
 * Kaizen Todo — Typed API Client
 *
 * Wraps all Spring Boot REST endpoints with full TypeScript types.
 * Mirrors the frontend Todo / KaizenList / KaizenStats interfaces.
 *
 * Base URL: same origin (override via VITE_API_BASE_URL)
 */

import { simpleRequest } from './simpleRequest';
import type { RuleSpec } from './automationSpec';
import { trackSourceWrite } from './sourceSaves';

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type Quadrant   = 'DO' | 'SCHEDULE' | 'DELEGATE' | 'ELIMINATE';
export type Priority   = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ApiTask {
  id: string;
  title: string;
  status: TaskStatus;
  quadrant: Quadrant;
  priority: Priority | null;
  note: string | null;
  dueDate: string | null;   // ISO date YYYY-MM-DD
  dueTime: string | null;   // HH:MM
  category: string | null;
  listId: string | null;
  taskOrder: number;
  reminderEnabled: boolean;
  reminderMinutesBefore: number | null;
  /** DAILY, WEEKDAYS, WEEKLY or MONTHLY; null for a task that does not repeat. Absent from older servers. */
  recurrence?: string | null;
  completedAt: string | null;  // ISO-8601 instant
  createdAt: string;
  updatedAt: string;
  /** Set when the task was added from a note block via the @ menu. Absent from older servers. */
  sourceNoteId?: string | null;
  sourceBlockId?: string | null;
  /** Set when the task was added from a database's text column via the @ menu. */
  sourceRecordId?: string | null;
  sourceFieldId?: string | null;
  /** Shared workspaces: who the task is for. Absent from older servers and personal tasks. */
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  assignedBy?: string | null;
  assignedAt?: string | null;
  /** The tasks this one needs finished first (ids). Absent from older servers. */
  needsFirst?: string[];
}

export interface ApiList {
  id: string;
  name: string;
  color: string;
  listOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiMomentumStats {
  streak: number;
  totalCompleted: number;
  todayCompleted: number;
  listId: string;
  asOf: string;
}

export interface TaskCreateRequest {
  title: string;
  status?: TaskStatus;
  quadrant?: Quadrant;
  priority?: Priority;
  note?: string;
  dueDate?: string;
  dueTime?: string;
  category?: string;
  listId?: string;
  taskOrder?: number;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
  /** DAILY, WEEKDAYS, WEEKLY or MONTHLY; '' on update stops it repeating. */
  recurrence?: string;
  /** Completion time retained when importing an already completed local task. */
  completedAt?: string;
  /** The note block this task was added from; '' clears on update. */
  sourceNoteId?: string;
  sourceBlockId?: string;
  /** The database record + field this task was added from; '' clears on update. */
  sourceRecordId?: string;
  sourceFieldId?: string;
  /** Who the task is for (a member's user id); '' clears on update. */
  assigneeUserId?: string;
  assigneeName?: string;
  /** The tasks this one needs finished first (ids); [] clears on update. */
  needsFirst?: string[];
  /** Stable local id used only by the one-time offline migration. */
  clientId?: string;
}

export type TaskUpdateRequest = Partial<TaskCreateRequest>;

export interface ListCreateRequest {
  name: string;
  color?: string;
  listOrder?: number;
  /** Stable local id used only by the one-time offline migration. */
  clientId?: string;
}

export type ListUpdateRequest = Partial<ListCreateRequest>;

export interface ApiError {
  status: number;
  message: string;
  timestamp: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * API base URL — resolved in priority order:
 *  1. VITE_API_BASE_URL env var (set for cross-origin hosted deployments)
 *  2. Empty string → same-origin /api (works for both Vite dev proxy and
 *     production deployments where the frontend and API share an origin)
 *
 * Do NOT hardcode a port here. The Vite dev server proxies /api → localhost:3001
 * so relative paths work in dev. In production the server serves the built
 * frontend from the same origin, so /api is always correct.
 */
const BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

/** The API origin, '' when same-origin. Shared with notes sync. */
export const API_BASE_URL = BASE_URL;

export const AUTOMATIONS_UNAVAILABLE_REASON =
  'Automations are switched off on this server.';
export const ZOHO_CALENDAR_UNAVAILABLE_REASON =
  'Zoho Calendar import is unavailable in the PostgreSQL-only migration.';

// ── Core fetch helper ────────────────────────────────────────────────────────

/**
 * Returns true if the response Content-Type indicates JSON.
 * Guards against an HTML error page or redirect being mistaken for JSON.
 */
function isJsonResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') || ct.includes('text/json');
}

/**
 * Classifies a fetch error as a network/connectivity error vs an API error.
 * Network errors (TypeError: Failed to fetch, AbortError, etc.) mean the
 * backend is unreachable and the app should fall back to local storage.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true; // "Failed to fetch", "NetworkError"
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  if (e instanceof DOMException && e.name === 'TimeoutError') return true;
  return false;
}

/**
 * The browser's IANA timezone, sent on every request.
 *
 * The server needs it to turn a task's dueDate + dueTime — which are stored
 * with no zone at all — into the absolute instant a reminder fires. Without
 * it the server interprets those digits in its own zone (UTC), so a 2:30pm
 * reminder set in Kolkata would fire at 8:00pm local time.
 *
 * Read per call rather than once at module load: a laptop that crosses a
 * timezone mid-session should schedule in the zone it is now in.
 */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const write = performRequest<T>(path, options);
  return options.method && options.method !== 'GET' && /^\/(databases|fields|field-values|views)(\/|$)/.test(path)
    ? trackSourceWrite(write, `${options.method} ${path.split('?')[0]}`) : write;
}

async function performRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // Sent as a CORS simple request — no custom headers, no JSON content type,
  // no PUT/PATCH/DELETE — to avoid unnecessary preflights. See
  // lib/simpleRequest.ts.
  const { method, body, headers: _headers, ...rest } = options;
  const simple = simpleRequest(
    `${BASE_URL}/api${path}`,
    method ?? 'GET',
    typeof body === 'string' ? body : undefined,
    browserTimeZone(),
  );
  const res = await fetch(simple.url, { ...rest, ...simple.init });

  if (!res.ok) {
    // 401/403 responses may be HTML or JSON; treat both as access failures.
    if (res.status === 401 || res.status === 403) {
      const err: ApiError = {
        status: res.status,
        message: res.status === 401
          ? 'Session expired — please sign in again'
          : 'Access denied',
        timestamp: new Date().toISOString(),
      };
      throw err;
    }

    // 5xx errors — backend is up but unhealthy
    if (res.status >= 500) {
      const err: ApiError = {
        status: res.status,
        message: 'Server error — your changes are saved locally',
        timestamp: new Date().toISOString(),
      };
      throw err;
    }

    let message = `Request failed (${res.status})`;
    if (isJsonResponse(res)) {
      try {
        const body = await res.json() as { message?: string; error?: string };
        message = body.message ?? body.error ?? message;
      } catch {
        // ignore parse errors on error body
      }
    } else {
      // Non-JSON error body (HTML error page, etc.) — use a clean message
      message = res.statusText
        ? `${res.statusText} (${res.status})`
        : `Request failed (${res.status})`;
    }
    const err: ApiError = { status: res.status, message, timestamp: new Date().toISOString() };
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  // Guard: if the server returned non-JSON (e.g. HTML from a fallback page),
  // throw a descriptive error instead of letting JSON.parse fail with
  // "Unexpected token '<'".
  if (!isJsonResponse(res)) {
    const err: ApiError = {
      status: res.status,
      message: 'Unexpected response from server — working offline',
      timestamp: new Date().toISOString(),
    };
    throw err;
  }

  return res.json() as Promise<T>;
}

function get<T>(path: string)                        { return request<T>(path, { method: 'GET' }); }
function post<T>(path: string, body: unknown)        { return request<T>(path, { method: 'POST',   body: JSON.stringify(body) }); }
function put<T>(path: string, body: unknown)         { return request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }); }
function patch<T>(path: string, body?: unknown)      { return request<T>(path, { method: 'PATCH',  body: body ? JSON.stringify(body) : undefined }); }
function del<T>(path: string)                        { return request<T>(path, { method: 'DELETE' }); }

// ── Task API ─────────────────────────────────────────────────────────────────

export interface TaskListParams {
  listId?:    string;
  status?:    string;   // comma-separated TaskStatus values
  priority?:  string;   // comma-separated Priority values
  quadrant?:  string;   // comma-separated Quadrant values
  search?:    string;
  dueBefore?: string;   // YYYY-MM-DD
  dueAfter?:  string;   // YYYY-MM-DD
  sortBy?:    'order' | 'created' | 'due-date' | 'priority' | 'status' | 'title';
  sortDir?:   'asc' | 'desc';
}

export const taskApi = {
  /**
   * GET /api/tasks
   * Full server-side filter/sort/search support.
   */
  list(params?: TaskListParams): Promise<ApiTask[]> {
    const qs = new URLSearchParams();
    if (params?.listId)    qs.set('listId',    params.listId);
    if (params?.status)    qs.set('status',    params.status);
    if (params?.priority)  qs.set('priority',  params.priority);
    if (params?.quadrant)  qs.set('quadrant',  params.quadrant);
    if (params?.search)    qs.set('search',    params.search);
    if (params?.dueBefore) qs.set('dueBefore', params.dueBefore);
    if (params?.dueAfter)  qs.set('dueAfter',  params.dueAfter);
    if (params?.sortBy)    qs.set('sortBy',    params.sortBy);
    if (params?.sortDir)   qs.set('sortDir',   params.sortDir);
    const query = qs.toString() ? `?${qs}` : '';
    return get<ApiTask[]>(`/tasks${query}`);
  },

  /** GET /api/tasks/{id} */
  get(id: string): Promise<ApiTask> {
    return get<ApiTask>(`/tasks/${id}`);
  },

  /**
   * GET /api/tasks/today-history
   * Returns tasks completed today (UTC). Optional listId filter.
   */
  todayHistory(listId?: string): Promise<ApiTask[]> {
    const qs = listId ? `?listId=${listId}` : '';
    return get<ApiTask[]>(`/tasks/today-history${qs}`);
  },

  /** POST /api/tasks */
  create(req: TaskCreateRequest): Promise<ApiTask> {
    return post<ApiTask>('/tasks', req);
  },

  /** PUT /api/tasks/{id} — full update */
  update(id: string, req: TaskUpdateRequest): Promise<ApiTask> {
    return put<ApiTask>(`/tasks/${id}`, req);
  },

  /**
   * PATCH /api/tasks/{id}/status
   * Body: { status: "DONE" | "TODO" | "IN_PROGRESS" }
   */
  updateStatus(id: string, status: TaskStatus): Promise<ApiTask> {
    return patch<ApiTask>(`/tasks/${id}/status`, { status });
  },

  /**
   * PATCH /api/tasks/{id}/complete
   * Marks task DONE and records completedAt server-side.
   */
  markComplete(id: string): Promise<ApiTask> {
    return patch<ApiTask>(`/tasks/${id}/complete`);
  },

  /**
   * PATCH /api/tasks/{id}/quadrant
   * Reprioritizes without touching other fields.
   */
  reprioritize(id: string, quadrant: Quadrant): Promise<ApiTask> {
    return patch<ApiTask>(`/tasks/${id}/quadrant`, { quadrant });
  },

  /** DELETE /api/tasks/{id} */
  delete(id: string): Promise<void> {
    return del<void>(`/tasks/${id}`);
  },
};

// ── List API ─────────────────────────────────────────────────────────────────

export const listApi = {
  /** GET /api/lists */
  list(): Promise<ApiList[]> {
    return get<ApiList[]>('/lists');
  },

  /** GET /api/lists/{id} */
  get(id: string): Promise<ApiList> {
    return get<ApiList>(`/lists/${id}`);
  },

  /** POST /api/lists */
  create(req: ListCreateRequest): Promise<ApiList> {
    return post<ApiList>('/lists', req);
  },

  /** PUT /api/lists/{id} */
  update(id: string, req: ListUpdateRequest): Promise<ApiList> {
    return put<ApiList>(`/lists/${id}`, req);
  },

  /** DELETE /api/lists/{id} */
  delete(id: string): Promise<void> {
    return del<void>(`/lists/${id}`);
  },
};

// ── Stats API ─────────────────────────────────────────────────────────────────

export const statsApi = {
  /**
   * GET /api/stats/momentum
   * Optional listId for per-list stats; omit for global.
   */
  momentum(listId?: string): Promise<ApiMomentumStats> {
    const qs = listId ? `?listId=${listId}` : '';
    return get<ApiMomentumStats>(`/stats/momentum${qs}`);
  },
};

// ── Notification inbox ────────────────────────────────────────────────────────

/** One delivered notification, as the server stores it. */
export interface ApiNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  /** Epoch ms it was read, or 0 while unread. */
  readAt: number;
  createdAt: number;
  payload?: Record<string, unknown>;
}

export const notificationApi = {
  /** GET /api/notifications — newest first. */
  list(): Promise<ApiNotification[]> {
    return get<ApiNotification[]>('/notifications');
  },

  /** PATCH /api/notifications/:id/read */
  markRead(id: string): Promise<void> {
    return patch<void>(`/notifications/${id}/read`);
  },

  /** PATCH /api/notifications/read-all */
  markAllRead(): Promise<{ updated: number }> {
    return patch<{ updated: number }>('/notifications/read-all');
  },

  /** DELETE /api/notifications/:id — dismiss for good. */
  remove(id: string): Promise<void> {
    return del<void>(`/notifications/${id}`);
  },

};

// ── Automations ──────────────────────────────────────────────────────────────

export interface ApiReminderOffset {
  value: number;
  unit: 'minutes' | 'hours' | 'days';
}

export interface ApiRecurrence {
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly';
  time: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface ApiAutomationRule {
  id: string;
  name: string;
  description?: string;
  taskId?: string;
  triggerType: 'due-date' | 'overdue' | 'recurring' | 'status-change' | 'daily-digest' | 'custom';
  status: 'active' | 'paused' | 'draft';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Signed minutes from the due instant, one per firing: -60 is an hour
   * before, 0 is when it falls due, 30 is half an hour after. The server fills
   * this in for rules written before it existed, so it is always the truth
   * about when a task-driven rule fires.
   */
  offsetMinutes?: number[];
  /** The single offset the first step describes. Superseded by offsetMinutes. */
  reminderOffset?: ApiReminderOffset;
  recurrence?: ApiRecurrence;
  notifyInApp: boolean;
  notifyBrowser: boolean;
  notifyEmail: boolean;
  /** IANA zone the schedule and due times are read in; the server falls back to its own. */
  timezone?: string;
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt?: number;
  /** When the rule next fires. Absent for the event-driven triggers. */
  nextTriggerAt?: number;
  /** What the rule watches, checks and does. Every rule the server returns has one; sent back, it replaces the rule's meaning. */
  spec?: RuleSpec;
  /** Set when the rule stopped working (for example after repeated failed runs). */
  error?: string;
}

export type AutomationRuleInput = Omit<
  ApiAutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'lastTriggeredAt' | 'nextTriggerAt' | 'error'
>;

export interface ApiAutomationRun {
  id: string;
  ruleId: string;
  /** Copied onto the run, so the trail survives the rule being deleted. */
  ruleName: string;
  triggeredAt: number;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  source: 'scheduler' | 'manual';
  detail: string;
  channels: string[];
}

export const automationApi = {
  /** GET /api/automations */
  listRules: () => get<ApiAutomationRule[]>('/automations'),
  /** POST /api/automations */
  createRule: (rule: AutomationRuleInput) => post<ApiAutomationRule>('/automations', rule),
  /** PUT /api/automations/:id */
  updateRule: (id: string, rule: AutomationRuleInput) => put<ApiAutomationRule>(`/automations/${id}`, rule),
  /** DELETE /api/automations/:id */
  deleteRule: (id: string) => del<void>(`/automations/${id}`),
  /** GET /api/automations/runs?limit= — newest first, every rule. */
  recentRuns: (limit = 20) => get<ApiAutomationRun[]>(`/automations/runs?limit=${limit}`),
  /** GET /api/automations/:id/runs */
  runsForRule: (ruleId: string) => get<ApiAutomationRun[]>(`/automations/${ruleId}/runs`),
  /** POST /api/automations/:id/trigger — "Run now". */
  trigger: (ruleId: string) => post<ApiAutomationRun>(`/automations/${ruleId}/trigger`, {}),
};

// ── Saved views ───────────────────────────────────────────────────────────────

/** How the tasks page shows tasks. */
export type TaskLayout = 'list' | 'matrix' | 'table' | 'board' | 'calendar';

/** A table's columns in a saved view: hidden ones, their order, any dragged widths. */
export interface ViewDisplay {
  hidden: string[];
  order: string[];
  widths: Record<string, number>;
  /** Databases only, all additive/optional — stored as extra keys in the same JSON blob. */
  sort?: { fieldId: string; dir: 1 | -1 } | null;
  groupField?: string | null;
  calc?: Record<string, string>;
  frozenFieldId?: string | null;
  wrapFieldIds?: string[];
}

export interface ApiSavedView {
  id: string;
  name: string;
  layout: TaskLayout;
  /** A list the view opens; null = whichever list is open. */
  scopeListId: string | null;
  /** A database the view opens; null for a Task view, or a Task view with no list scope. */
  scopeDatabaseId: string | null;
  filters: import('./taskFilters').FilterState;
  showDone: boolean;
  display: ViewDisplay;
  viewOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type SavedViewInput = Pick<ApiSavedView, 'name' | 'layout' | 'scopeListId' | 'scopeDatabaseId' | 'filters' | 'showDone'> & {
  viewOrder?: number;
  /** Left out when a screen has no column choices to keep. */
  display?: ViewDisplay;
};

export const viewApi = {
  list(): Promise<ApiSavedView[]> {
    return get<ApiSavedView[]>('/views');
  },
  create(view: SavedViewInput): Promise<ApiSavedView> {
    return post<ApiSavedView>('/views', { ...view, scopeListId: view.scopeListId ?? '', scopeDatabaseId: view.scopeDatabaseId ?? '' });
  },
  update(id: string, view: SavedViewInput): Promise<ApiSavedView> {
    return put<ApiSavedView>(`/views/${id}`, { ...view, scopeListId: view.scopeListId ?? '', scopeDatabaseId: view.scopeDatabaseId ?? '' });
  },
  delete(id: string): Promise<void> {
    return del<void>(`/views/${id}`);
  },
};

// ── Custom task fields ────────────────────────────────────────────────────────

type FieldDef = import('../types/fields').FieldDef;
type FieldValue = import('../types/fields').FieldValue;

export interface ApiFieldValue {
  taskId: string;
  fieldId: string;
  /** null once cleared. */
  value: FieldValue | null;
}

export interface FieldInput {
  name: string;
  kind: import('../types/fields').FieldKind;
  /** For select and multi. Keep an option's id to keep the tasks that use it. */
  options?: Array<{ id?: string; label: string; color?: import('../types/fields').OptionColor }>;
  showOnCard?: boolean;
  fieldOrder?: number;
}

export const fieldApi = {
  /** A database's fields, or the task fields when databaseId is omitted. */
  listFields(databaseId?: string): Promise<FieldDef[]> {
    return get<FieldDef[]>(databaseId ? `/fields?databaseId=${encodeURIComponent(databaseId)}` : '/fields');
  },
  /** Creates a field on a database, or on tasks when databaseId is omitted. */
  createField(input: FieldInput, databaseId?: string): Promise<FieldDef> {
    return post<FieldDef>('/fields', databaseId ? { ...input, databaseId } : input);
  },
  updateField(id: string, input: FieldInput): Promise<FieldDef> {
    return put<FieldDef>(`/fields/${id}`, input);
  },
  /** Also removes every task's value for the field. */
  deleteField(id: string): Promise<void> {
    return del<void>(`/fields/${id}`);
  },
  listValues(): Promise<ApiFieldValue[]> {
    return get<ApiFieldValue[]>('/field-values');
  },
  /** Sets one task's value for one field; null clears it. */
  setValue(taskId: string, fieldId: string, value: FieldValue | null): Promise<ApiFieldValue> {
    return put<ApiFieldValue>(`/tasks/${taskId}/fields/${fieldId}`, { value });
  },
};

// ── Databases ────────────────────────────────────────────────────────────────

/** A collection of records that are not tasks. */
export interface ApiDatabase {
  id: string;
  name: string;
  icon: string;
  /** The date field this database's calendar reads; '' = none chosen yet. */
  dateFieldId: string;
  /** The Title column's own header label — renamable, defaults to "Title". */
  titleLabel: string;
  dbOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** One record. Title is its only built-in column; the rest are custom fields. */
export interface ApiDatabaseRow {
  id: string;
  databaseId: string;
  title: string;
  rowOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** `name` is required to create a database; every field here is optional on an update — the server keeps whatever isn't sent. */
export interface DatabaseInput { name?: string; icon?: string; dateFieldId?: string; titleLabel?: string; dbOrder?: number }
export interface DatabaseRowInput { title: string; rowOrder?: number }

export const databaseApi = {
  list(): Promise<ApiDatabase[]> {
    return get<ApiDatabase[]>('/databases');
  },
  create(input: DatabaseInput): Promise<ApiDatabase> {
    return post<ApiDatabase>('/databases', { icon: '', dateFieldId: '', ...input });
  },
  update(id: string, input: DatabaseInput): Promise<ApiDatabase> {
    return put<ApiDatabase>(`/databases/${id}`, { icon: '', dateFieldId: '', ...input });
  },
  /**
   * POST, not DELETE: deleting a database also deletes its records, and the
   * server answers with how many went with it.
   */
  remove(id: string): Promise<{ ok: true; recordsRemoved: number }> {
    return post<{ ok: true; recordsRemoved: number }>(`/databases/${id}/delete`, {});
  },

  listRows(databaseId: string): Promise<ApiDatabaseRow[]> {
    return get<ApiDatabaseRow[]>(`/databases/${databaseId}/rows`);
  },
  createRow(databaseId: string, input: DatabaseRowInput): Promise<ApiDatabaseRow> {
    return post<ApiDatabaseRow>(`/databases/${databaseId}/rows`, input);
  },
  updateRow(recordId: string, input: DatabaseRowInput): Promise<ApiDatabaseRow> {
    return put<ApiDatabaseRow>(`/databases/rows/${recordId}`, input);
  },
  deleteRow(recordId: string): Promise<void> {
    return del<void>(`/databases/rows/${recordId}`);
  },

  /**
   * Every value in one database. Not fieldApi.listValues, which joins against
   * the task fields and so would drop a record's values.
   */
  listFieldValues(databaseId: string): Promise<ApiRecordValue[]> {
    return get<ApiRecordValue[]>(`/databases/${databaseId}/field-values`);
  },
  /** Sets one record's value for one of its database's fields; null clears it. */
  setFieldValue(recordId: string, fieldId: string, value: FieldValue | null): Promise<ApiRecordValue> {
    return put<ApiRecordValue>(`/databases/rows/${recordId}/fields/${fieldId}`, { value });
  },
};

export interface ApiRecordValue {
  recordId: string;
  fieldId: string;
  /** null once cleared. */
  value: FieldValue | null;
}

// ── The calendar ─────────────────────────────────────────────────────────────

/** A task on the calendar. Only tasks with a due date are returned. */
export interface CalendarTask {
  id: string;
  title: string;
  listId: string;
  status: TaskStatus;
  dueDate: string;
  dueTime: string;
  quadrant: Quadrant;
}

/** A database record on the calendar, by its database's chosen date column. */
export interface CalendarRecord {
  id: string;
  databaseId: string;
  databaseName: string;
  title: string;
  date: string;
}

export const calendarApi = {
  /** Everything that sits on a date, in one request. */
  load(): Promise<{ tasks: CalendarTask[]; records: CalendarRecord[] }> {
    return get<{ tasks: CalendarTask[]; records: CalendarRecord[] }>('/calendar');
  },
};

// ── Favorites and recents ────────────────────────────────────────────────────

export type PageKind = 'list' | 'note' | 'database';
export interface ApiPageMark { kind: PageKind; id: string; createdAt?: number; visitedAt?: number }

export const pageMarksApi = {
  favorites: () => get<ApiPageMark[]>('/favorites'),
  addFavorite: (kind: PageKind, id: string) => put<ApiPageMark>(`/favorites/${kind}/${id}`, {}),
  removeFavorite: (kind: PageKind, id: string) => del<void>(`/favorites/${kind}/${id}`),
  recents: () => get<ApiPageMark[]>('/recents'),
  visit: (kind: PageKind, id: string) => post<ApiPageMark>(`/recents/${kind}/${id}`, {}),
  removeRecent: (kind: PageKind, id: string) => del<void>(`/recents/${kind}/${id}`),
};

// ── Progress log (the Monday update) ─────────────────────────────────────────

export type ProgressState = 'moved' | 'blocked' | 'discussed' | 'done';
export interface ApiProgressEntry {
  id: string; text: string; state: ProgressState; at: number; section: string;
  taskId: string; noteId: string; recordId: string; createdAt: number; updatedAt: number;
}
export interface ProgressEntryInput {
  clientId?: string; text: string; state?: ProgressState; at?: number; section?: string; taskId?: string;
}

export const progressApi = {
  list: (from = 0, to?: number) => get<ApiProgressEntry[]>(`/worklog?from=${from}${to === undefined ? '' : `&to=${to}`}`),
  create: (input: ProgressEntryInput) => post<ApiProgressEntry>('/worklog', input),
  update: (id: string, input: Partial<ProgressEntryInput>) => put<ApiProgressEntry>(`/worklog/${id}`, input),
  remove: (id: string) => del<void>(`/worklog/${id}`),
};

// ── Trial features ───────────────────────────────────────────────────────────

/** App-wide switches returned by the backend. */
export interface TrialFeatures {
  notifications: boolean;
  automations: boolean;
  unavailableReason?: string;
}

export const trialFeatureApi = {
  /** GET /api/trial-features */
  async get(): Promise<TrialFeatures> {
    const flags = await get<{ notifications: boolean; automations: boolean }>('/trial-features');
    return {
      notifications: !!flags.notifications,
      automations: !!flags.automations,
      unavailableReason: flags.automations ? undefined : AUTOMATIONS_UNAVAILABLE_REASON,
    };
  },
};

// ── Health check ─────────────────────────────────────────────────────────────

/**
 * Lightweight connectivity check.
 * Returns true if the server is reachable AND returns a valid JSON health
 * response. Explicitly rejects HTML responses so the app correctly falls back
 * to localStorage instead of treating a fallback page as a live server.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    // Verify the response is actually JSON — text/html must NOT be treated as a
    // healthy server.
    if (!isJsonResponse(res)) return false;
    const body = await res.json() as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

// ── Backup (P6.4) ────────────────────────────────────────────────────────────

export interface BackupFile {
  schema: string;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export interface BackupImportResult {
  ok: boolean;
  imported: Record<string, number>;
  skipped: Record<string, number>;
}

export const backupApi = {
  export: () => get<BackupFile>('/backup'),
  import: (file: unknown) => post<BackupImportResult>('/backup', file),
};
