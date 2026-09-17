/**
 * Automation rules.
 *
 * These used to live only in localStorage, seeded with three examples, and
 * nothing anywhere read one and decided to fire it. A user could configure
 * "remind me 30 minutes before, in-app and in the browser", see it listed as
 * active with a next-run time, and nothing would ever happen. The rules are
 * now server-side, where the sweep's PLAN phase evaluates them.
 *
 * localStorage remains as an offline fallback, in the same shape the rest of
 * the app uses: read it when the server cannot be reached, and let the server
 * win the moment it answers. A rule created offline is a local draft — it
 * cannot fire, because firing happens server-side, and pretending otherwise
 * would be the same false promise this work exists to remove.
 */
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type {
  AutomationRule, AutomationRuleFormValues, AutomationStatus,
} from '@/types/automation';
import { automationApi, isNetworkError, type ApiAutomationRule, type AutomationRuleInput } from '@/lib/api';
import { normaliseSteps } from '@/lib/reminderSteps';
import { getActiveUserId } from '@/lib/storage';

const STORAGE_KEY = 'kaizen-automations-v1';

export function automationStorageKey(userId: string | null = getActiveUserId()): string {
  return userId ? `${STORAGE_KEY}-${userId}` : STORAGE_KEY;
}

function loadFromStorage(userId?: string | null): AutomationRule[] {
  try {
    const raw = localStorage.getItem(automationStorageKey(userId));
    if (raw) return JSON.parse(raw) as AutomationRule[];
  } catch {
    // ignore
  }
  // Deliberately empty rather than seeded. Example rules that cannot fire are
  // exactly the impression this work is correcting.
  return [];
}

function saveToStorage(rules: AutomationRule[], userId?: string | null) {
  try {
    localStorage.setItem(automationStorageKey(userId), JSON.stringify(rules));
  } catch {
    // ignore
  }
}

// ── Shape conversion ─────────────────────────────────────────────────────────

function fromApi(rule: ApiAutomationRule, todos: { id: string; text: string }[]): AutomationRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    taskId: rule.taskId,
    // Resolved from the current task list rather than stored, so a renamed
    // task shows its new name.
    taskTitle: rule.taskId ? todos.find((t) => t.id === rule.taskId)?.text : undefined,
    triggerType: rule.triggerType,
    status: rule.status,
    urgency: rule.urgency,
    offsetMinutes: rule.offsetMinutes,
    reminderOffset: rule.reminderOffset,
    recurrence: rule.recurrence,
    notifyInApp: rule.notifyInApp,
    notifyBrowser: rule.notifyBrowser,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    lastTriggeredAt: rule.lastTriggeredAt,
    nextTriggerAt: rule.nextTriggerAt,
  };
}

/** The form's strings, parsed into what the API expects. */
function formValuesToInput(values: AutomationRuleFormValues): AutomationRuleInput {
  const scheduled = values.triggerType === 'recurring' || values.triggerType === 'daily-digest';
  const taskDriven = values.triggerType === 'due-date' || values.triggerType === 'overdue';

  return {
    name: values.name.trim(),
    description: values.description.trim() || undefined,
    taskId: values.taskId || undefined,
    triggerType: values.triggerType,
    status: values.status,
    urgency: values.urgency,
    offsetMinutes: taskDriven ? normaliseSteps(values.offsetMinutes) : undefined,
    recurrence: scheduled
      ? {
          frequency: values.recurrenceFrequency,
          // The server rejects a scheduled rule with no time, so default here
          // rather than letting the form produce a rule that cannot be saved.
          time: values.recurrenceTime || '09:00',
          dayOfWeek: parseInt(values.recurrenceDayOfWeek, 10) || 0,
          dayOfMonth: parseInt(values.recurrenceDayOfMonth, 10) || 1,
        }
      : undefined,
    notifyInApp: values.notifyInApp,
    notifyBrowser: values.notifyBrowser,
    notifyEmail: values.notifyEmail,
  };
}

/** A local stand-in, for the offline path only. */
function inputToLocalRule(
  input: AutomationRuleInput,
  existing: AutomationRule | undefined,
  taskTitle: string | undefined,
): AutomationRule {
  const now = Date.now();
  return {
    ...input,
    id: existing?.id ?? `auto-${crypto.randomUUID()}`,
    taskTitle,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastTriggeredAt: existing?.lastTriggeredAt,
    // No nextTriggerAt offline: the server computes it, and inventing one here
    // would display a firing time for a rule that cannot fire.
    nextTriggerAt: undefined,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseAutomationsReturn {
  rules: AutomationRule[];
  loading: boolean;
  /** False while working from localStorage; rules cannot fire in that state. */
  online: boolean;
  error: string | null;
  addRule: (values: AutomationRuleFormValues) => Promise<AutomationRule | null>;
  updateRule: (id: string, values: AutomationRuleFormValues) => Promise<void>;
  toggleStatus: (id: string) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAutomations(
  todos: { id: string; text: string }[],
  userId: string | null = getActiveUserId(),
): UseAutomationsReturn {
  const [rules, setRules] = useState<AutomationRule[]>(() => loadFromStorage(userId));
  const [rulesUserId, setRulesUserId] = useState(userId);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A ref so refresh() does not have to be rebuilt, and re-run, every time a
  // task's text changes.
  const todosRef = useRef(todos);
  useEffect(() => { todosRef.current = todos; });
  const userRef = useRef(userId);
  useLayoutEffect(() => {
    userRef.current = userId;
    setRules(loadFromStorage(userId));
    setRulesUserId(userId);
    setOnline(false);
    setLoading(true);
  }, [userId]);

  const refresh = useCallback(async () => {
    const requestUserId = userId;
    try {
      const fetched = await automationApi.listRules();
      if (requestUserId !== userRef.current) return;
      setRules(fetched.map((r) => fromApi(r, todosRef.current)));
      setOnline(true);
      setError(null);
    } catch (e) {
      if (requestUserId !== userRef.current) return;
      if (!isNetworkError(e)) console.warn('[kaizen] automation rules unavailable:', e);
      setOnline(false);
      setRules(loadFromStorage(requestUserId));
    } finally {
      if (requestUserId === userRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Applies a change locally when offline, or through the server when not. */
  const persistLocally = useCallback((next: AutomationRule[]) => {
    setRules(next);
    saveToStorage(next, userId);
  }, [userId]);

  const addRule = useCallback(async (values: AutomationRuleFormValues) => {
    const input = formValuesToInput(values);
    const taskTitle = todosRef.current.find((t) => t.id === values.taskId)?.text;

    if (!online) {
      const local = inputToLocalRule(input, undefined, taskTitle);
      persistLocally([local, ...rules]);
      return local;
    }

    try {
      const created = await automationApi.createRule(input);
      const rule = fromApi(created, todosRef.current);
      setRules((prev) => [rule, ...prev]);
      setError(null);
      return rule;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rule');
      return null;
    }
  }, [online, rules, persistLocally]);

  const updateRule = useCallback(async (id: string, values: AutomationRuleFormValues) => {
    const existing = rules.find((r) => r.id === id);
    if (!existing) return;

    const input = formValuesToInput(values);
    const taskTitle = todosRef.current.find((t) => t.id === values.taskId)?.text;

    if (!online) {
      persistLocally(rules.map((r) => (r.id === id ? inputToLocalRule(input, existing, taskTitle) : r)));
      return;
    }

    try {
      const saved = await automationApi.updateRule(id, input);
      const rule = fromApi(saved, todosRef.current);
      setRules((prev) => prev.map((r) => (r.id === id ? rule : r)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rule');
    }
  }, [online, rules, persistLocally]);

  const toggleStatus = useCallback(async (id: string) => {
    const existing = rules.find((r) => r.id === id);
    if (!existing) return;

    const status: AutomationStatus = existing.status === 'active' ? 'paused' : 'active';

    if (!online) {
      persistLocally(rules.map((r) => (r.id === id ? { ...r, status, updatedAt: Date.now() } : r)));
      return;
    }

    // Show the new state immediately; pausing a rule should feel instant.
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));

    try {
      // A whole-rule update rather than a status patch: pausing changes when
      // the rule next fires, which the server recomputes from the full rule.
      const saved = await automationApi.updateRule(id, {
        name: existing.name,
        description: existing.description,
        taskId: existing.taskId,
        triggerType: existing.triggerType,
        status,
        urgency: existing.urgency,
        offsetMinutes: existing.offsetMinutes,
        reminderOffset: existing.reminderOffset,
        recurrence: existing.recurrence,
        notifyInApp: existing.notifyInApp,
        notifyBrowser: existing.notifyBrowser,
        notifyEmail: existing.notifyEmail ?? false,
      });
      setRules((prev) => prev.map((r) => (r.id === id ? fromApi(saved, todosRef.current) : r)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the rule');
      void refresh();
    }
  }, [online, rules, persistLocally, refresh]);

  const deleteRule = useCallback(async (id: string) => {
    if (!online) {
      persistLocally(rules.filter((r) => r.id !== id));
      return;
    }

    setRules((prev) => prev.filter((r) => r.id !== id));
    try {
      await automationApi.deleteRule(id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the rule');
      void refresh();
    }
  }, [online, rules, persistLocally, refresh]);

  // A caller that does not remount this hook on account changes must not render
  // the previous user's offline draft rules while the effect loads the new key.
  return {
    rules: rulesUserId === userId ? rules : [],
    loading, online, error, addRule, updateRule, toggleStatus, deleteRule, refresh,
  };
}
