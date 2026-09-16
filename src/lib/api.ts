/**
 * Kaizen Todo — Typed API Client
 *
 * Wraps all Spring Boot REST endpoints with full TypeScript types.
 * Mirrors the frontend Todo / KaizenList / KaizenStats interfaces.
 *
 * Base URL: same origin (override via VITE_API_BASE_URL)
 */

import { simpleRequest } from './simpleRequest';

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
  completedAt: string | null;  // ISO-8601 instant
  createdAt: string;
  updatedAt: string;
  /** Set when the task was added from a note block via the @ menu. Absent from older servers. */
  sourceNoteId?: string | null;
  sourceBlockId?: string | null;
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
  /** The note block this task was added from; '' clears on update. */
  sourceNoteId?: string;
  sourceBlockId?: string;
}

export type TaskUpdateRequest = Partial<TaskCreateRequest>;

export interface ListCreateRequest {
  name: string;
  color?: string;
  listOrder?: number;
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

// ── Core fetch helper ────────────────────────────────────────────────────────

/**
 * Returns true if the response Content-Type indicates JSON.
 * Guards against Catalyst gateway returning HTML (login redirects, 401 pages).
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

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // Sent as a CORS simple request — no custom headers, no JSON content type,
  // no PUT/PATCH/DELETE — because the AppSail gateway answers preflights
  // itself without CORS headers. See lib/simpleRequest.ts. It also sends the
  // session cookie (credentials: 'include'), without which the cross-origin
  // Slate build would get a 401 on every call.
  const { method, body, headers: _headers, ...rest } = options;
  const simple = simpleRequest(
    `${BASE_URL}/api${path}`,
    method ?? 'GET',
    typeof body === 'string' ? body : undefined,
    browserTimeZone(),
  );
  const res = await fetch(simple.url, { ...rest, ...simple.init });

  if (!res.ok) {
    // 401/403 from Catalyst gateway often returns an HTML login page.
    // Treat as an auth/connectivity error without trying to parse the body.
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
      // Non-JSON error body (HTML gateway page, etc.) — use a clean message
      message = res.statusText
        ? `${res.statusText} (${res.status})`
        : `Request failed (${res.status})`;
    }
    const err: ApiError = { status: res.status, message, timestamp: new Date().toISOString() };
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  // Guard: if the server returned non-JSON (e.g. HTML from a gateway redirect),
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

  /**
   * POST /api/reminders/backfill
   *
   * Queues reminders for tasks that predate the queue. Idempotent, so the
   * client can call it on sign-in without tracking whether it already has.
   */
  backfill(): Promise<{ scanned: number; enqueued: number; failed: number }> {
    return post<{ scanned: number; enqueued: number; failed: number }>('/reminders/backfill', {});
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
  triggerType: 'due-date' | 'overdue' | 'recurring' | 'status-change' | 'daily-digest';
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
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt?: number;
  /** When the rule next fires. Absent for the event-driven triggers. */
  nextTriggerAt?: number;
}

export type AutomationRuleInput = Omit<
  ApiAutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'lastTriggeredAt' | 'nextTriggerAt'
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
  listRules(): Promise<ApiAutomationRule[]> {
    return get<ApiAutomationRule[]>('/automation-rules');
  },

  createRule(rule: AutomationRuleInput): Promise<ApiAutomationRule> {
    return post<ApiAutomationRule>('/automation-rules', rule);
  },

  updateRule(id: string, rule: AutomationRuleInput): Promise<ApiAutomationRule> {
    return put<ApiAutomationRule>(`/automation-rules/${id}`, rule);
  },

  deleteRule(id: string): Promise<void> {
    return del<void>(`/automation-rules/${id}`);
  },

  recentRuns(limit = 20): Promise<ApiAutomationRun[]> {
    return get<ApiAutomationRun[]>(`/automation-runs/recent?limit=${limit}`);
  },

  runsForRule(ruleId: string): Promise<ApiAutomationRun[]> {
    return get<ApiAutomationRun[]>(`/automation-runs/rule/${ruleId}`);
  },

  /** Queues one firing by hand. Delivery still happens on the next sweep. */
  trigger(ruleId: string): Promise<ApiAutomationRun> {
    return post<ApiAutomationRun>(`/automation-runs/trigger/${ruleId}`, {});
  },
};

// ── Saved views ───────────────────────────────────────────────────────────────

/** How the tasks page shows tasks. */
export type TaskLayout = 'list' | 'matrix' | 'table' | 'board' | 'calendar';

/** A table's columns in a saved view: hidden ones, their order, any dragged widths. */
export interface ViewDisplay {
  hidden: string[];
  order: string[];
  widths: Record<string, number>;
}

export interface ApiSavedView {
  id: string;
  name: string;
  layout: TaskLayout;
  /** A list the view opens; null = whichever list is open. */
  scopeListId: string | null;
  filters: import('./taskFilters').FilterState;
  showDone: boolean;
  display: ViewDisplay;
  viewOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type SavedViewInput = Pick<ApiSavedView, 'name' | 'layout' | 'scopeListId' | 'filters' | 'showDone'> & {
  viewOrder?: number;
  /** Left out when a screen has no column choices to keep. */
  display?: ViewDisplay;
};

export const viewApi = {
  list(): Promise<ApiSavedView[]> {
    return get<ApiSavedView[]>('/views');
  },
  create(view: SavedViewInput): Promise<ApiSavedView> {
    return post<ApiSavedView>('/views', { ...view, scopeListId: view.scopeListId ?? '' });
  },
  update(id: string, view: SavedViewInput): Promise<ApiSavedView> {
    return put<ApiSavedView>(`/views/${id}`, { ...view, scopeListId: view.scopeListId ?? '' });
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
  listFields(): Promise<FieldDef[]> {
    return get<FieldDef[]>('/fields');
  },
  createField(input: FieldInput): Promise<FieldDef> {
    return post<FieldDef>('/fields', input);
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

/** A collection of records that are not tasks. See server/databases.ts. */
export interface ApiDatabase {
  id: string;
  name: string;
  icon: string;
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

export interface DatabaseInput { name: string; icon?: string; dbOrder?: number }
export interface DatabaseRowInput { title: string; rowOrder?: number }

export const databaseApi = {
  list(): Promise<ApiDatabase[]> {
    return get<ApiDatabase[]>('/databases');
  },
  create(input: DatabaseInput): Promise<ApiDatabase> {
    return post<ApiDatabase>('/databases', { icon: '', ...input });
  },
  update(id: string, input: DatabaseInput): Promise<ApiDatabase> {
    return put<ApiDatabase>(`/databases/${id}`, { icon: '', ...input });
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
};

// ── Trial features ───────────────────────────────────────────────────────────

/** App-wide switches set in the KaizenTrialFeatures table. See server/trialFeatures.ts. */
export interface TrialFeatures {
  notifications: boolean;
  automations: boolean;
}

export const trialFeatureApi = {
  /** GET /api/trial-features */
  get(): Promise<TrialFeatures> {
    return get<TrialFeatures>('/trial-features');
  },
};

// ── Health check ─────────────────────────────────────────────────────────────

/**
 * Lightweight connectivity check.
 * Returns true if the server is reachable AND returns a valid JSON health response.
 * Explicitly rejects HTML responses (Catalyst gateway login redirects, 401 pages)
 * so the app correctly falls back to localStorage instead of treating a gateway
 * intercept as a live server.
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    // Verify the response is actually JSON — a Catalyst gateway redirect or
    // auth page returns text/html which must NOT be treated as a healthy server.
    if (!isJsonResponse(res)) return false;
    const body = await res.json() as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}
