import { useState, useCallback } from 'react';
import type { AutomationRule, AutomationRuleFormValues, AutomationStatus } from '@/types/automation';
import { AUTOMATION_SEEDS } from '@/data/automationSeeds';

const STORAGE_KEY = 'kaizen-automations-v1';

function loadFromStorage(): AutomationRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AutomationRule[];
  } catch {
    // ignore
  }
  return AUTOMATION_SEEDS;
}

function saveToStorage(rules: AutomationRule[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // ignore
  }
}

function formValuesToRule(
  values: AutomationRuleFormValues,
  existing?: AutomationRule
): AutomationRule {
  const now = Date.now();
  const base: AutomationRule = {
    id: existing?.id ?? `auto-${crypto.randomUUID()}`,
    name: values.name.trim(),
    description: values.description.trim() || undefined,
    taskId: values.taskId || undefined,
    taskTitle: undefined, // caller sets this
    triggerType: values.triggerType,
    status: values.status,
    urgency: values.urgency,
    reminderOffset:
      values.triggerType === 'due-date'
        ? { value: Math.max(1, parseInt(values.offsetValue, 10) || 1), unit: values.offsetUnit }
        : undefined,
    recurrence:
      values.triggerType === 'recurring' || values.triggerType === 'daily-digest'
        ? {
            frequency: values.recurrenceFrequency,
            time: values.recurrenceTime || '09:00',
            dayOfWeek:
              values.recurrenceFrequency === 'weekly'
                ? parseInt(values.recurrenceDayOfWeek, 10)
                : undefined,
            dayOfMonth:
              values.recurrenceFrequency === 'monthly'
                ? parseInt(values.recurrenceDayOfMonth, 10)
                : undefined,
          }
        : undefined,
    notifyInApp: values.notifyInApp,
    notifyBrowser: values.notifyBrowser,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastTriggeredAt: existing?.lastTriggeredAt,
    nextTriggerAt: existing?.nextTriggerAt,
  };
  return base;
}

export function useAutomations(todos: { id: string; text: string }[]) {
  const [rules, setRules] = useState<AutomationRule[]>(() => loadFromStorage());

  const persist = useCallback((next: AutomationRule[]) => {
    setRules(next);
    saveToStorage(next);
  }, []);

  const addRule = useCallback(
    (values: AutomationRuleFormValues) => {
      const taskTitle = todos.find((t) => t.id === values.taskId)?.text;
      const rule = formValuesToRule(values);
      rule.taskTitle = taskTitle;
      persist([rule, ...rules]);
      return rule;
    },
    [rules, todos, persist]
  );

  const updateRule = useCallback(
    (id: string, values: AutomationRuleFormValues) => {
      const existing = rules.find((r) => r.id === id);
      if (!existing) return;
      const taskTitle = todos.find((t) => t.id === values.taskId)?.text;
      const updated = formValuesToRule(values, existing);
      updated.taskTitle = taskTitle;
      persist(rules.map((r) => (r.id === id ? updated : r)));
    },
    [rules, todos, persist]
  );

  const toggleStatus = useCallback(
    (id: string) => {
      persist(
        rules.map((r) => {
          if (r.id !== id) return r;
          const next: AutomationStatus =
            r.status === 'active' ? 'paused' : 'active';
          return { ...r, status: next, updatedAt: Date.now() };
        })
      );
    },
    [rules, persist]
  );

  const deleteRule = useCallback(
    (id: string) => {
      persist(rules.filter((r) => r.id !== id));
    },
    [rules, persist]
  );

  const resetToSeeds = useCallback(() => {
    persist(AUTOMATION_SEEDS);
  }, [persist]);

  return { rules, addRule, updateRule, toggleStatus, deleteRule, resetToSeeds };
}
