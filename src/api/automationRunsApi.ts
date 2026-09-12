/**
 * Automation Rules & Runs API client.
 * Mirrors the Spring Boot /api/automation-rules and /api/automation-runs endpoints.
 */

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:8080/api';

// ── Wire types ────────────────────────────────────────────────────────────────

export interface ApiAutomationRule {
  id: string;
  name: string;
  description: string | null;
  taskId: string | null;
  taskTitle: string | null;
  triggerType: string;
  status: string;
  urgency: string;
  notifyInApp: boolean;
  notifyBrowser: boolean;
  reminderOffsetJson: string | null;
  recurrenceJson: string | null;
  lastTriggeredAt: string | null; // ISO-8601
  nextTriggerAt: string | null;   // ISO-8601
  createdAt: string;              // ISO-8601
  updatedAt: string;              // ISO-8601
}

export interface ApiAutomationRun {
  id: string;
  ruleId: string;
  ruleName: string;
  triggeredAt: string; // ISO-8601
  /** success | skipped | error */
  status: string;
  message: string | null;
  /** scheduler | manual */
  triggerSource: string;
}

export interface AutomationRuleCreateRequest {
  name: string;
  description?: string;
  taskId?: string;
  taskTitle?: string;
  triggerType?: string;
  status?: string;
  urgency?: string;
  notifyInApp?: boolean;
  notifyBrowser?: boolean;
  reminderOffsetJson?: string;
  recurrenceJson?: string;
}

export type AutomationRuleUpdateRequest = AutomationRuleCreateRequest;

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.message ?? body.error ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ── Automation Rules API ──────────────────────────────────────────────────────

export const automationRulesApi = {
  /** GET /api/automation-rules */
  list(): Promise<ApiAutomationRule[]> {
    return request<ApiAutomationRule[]>('/automation-rules');
  },

  /** GET /api/automation-rules/{id} */
  get(id: string): Promise<ApiAutomationRule> {
    return request<ApiAutomationRule>(`/automation-rules/${id}`);
  },

  /** POST /api/automation-rules */
  create(req: AutomationRuleCreateRequest): Promise<ApiAutomationRule> {
    return request<ApiAutomationRule>('/automation-rules', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  /** PUT /api/automation-rules/{id} */
  update(id: string, req: AutomationRuleUpdateRequest): Promise<ApiAutomationRule> {
    return request<ApiAutomationRule>(`/automation-rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    });
  },

  /** PATCH /api/automation-rules/{id}/toggle */
  toggle(id: string): Promise<ApiAutomationRule> {
    return request<ApiAutomationRule>(`/automation-rules/${id}/toggle`, {
      method: 'PATCH',
    });
  },

  /** DELETE /api/automation-rules/{id} */
  delete(id: string): Promise<void> {
    return request<void>(`/automation-rules/${id}`, { method: 'DELETE' });
  },
};

// ── Automation Runs API ───────────────────────────────────────────────────────

export const automationRunsApi = {
  /** GET /api/automation-runs/recent — last 20 runs across all rules */
  getRecent(): Promise<ApiAutomationRun[]> {
    return request<ApiAutomationRun[]>('/automation-runs/recent');
  },

  /** GET /api/automation-runs?ruleId={id} — runs for a specific rule */
  getByRule(ruleId: string): Promise<ApiAutomationRun[]> {
    return request<ApiAutomationRun[]>(`/automation-runs?ruleId=${ruleId}`);
  },

  /** POST /api/automation-runs/trigger/{ruleId} — manual trigger */
  trigger(ruleId: string): Promise<ApiAutomationRun> {
    return request<ApiAutomationRun>(`/automation-runs/trigger/${ruleId}`, {
      method: 'POST',
    });
  },
};
