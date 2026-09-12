/**
 * Kaizen Todo — Typed API Client
 *
 * Wraps all Spring Boot REST endpoints with full TypeScript types.
 * Mirrors the frontend Todo / KaizenList / KaizenStats interfaces.
 *
 * Base URL: http://localhost:8080/api  (override via VITE_API_BASE_URL)
 */

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

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}/api${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

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
