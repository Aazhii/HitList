/**
 * Custom task fields and every task's values for them.
 *
 * Fields need the server: there is no offline copy. When the server cannot be
 * reached the hook reports `online: false` and holds no fields, and the UI says
 * fields are unavailable rather than showing an empty list that looks like
 * the user's fields were lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fieldApi, type FieldInput } from '@/lib/api';
import { LatestValueQueue } from '@/lib/latestValueQueue';
import type { FieldDef, FieldValue, TaskFieldValues } from '@/types/fields';

function errorMessage(e: unknown, fallback: string): string {
  const o = e as { message?: unknown; fields?: Record<string, string> } | null;
  const field = o?.fields ? Object.entries(o.fields)[0] : undefined;
  if (field) return `${field[0] === 'name' ? 'Name' : field[0]} ${field[1]}`;
  return typeof o?.message === 'string' && o.message ? o.message : fallback;
}

const byOrder = (a: FieldDef, b: FieldDef) => a.fieldOrder - b.fieldOrder || a.createdAt - b.createdAt;

export interface UseTaskFields {
  fields: FieldDef[];
  values: TaskFieldValues;
  online: boolean;
  loading: boolean;
  createField: (input: FieldInput) => Promise<FieldDef | null>;
  updateField: (id: string, input: FieldInput) => Promise<FieldDef | null>;
  deleteField: (id: string) => Promise<boolean>;
  setValue: (taskId: string, fieldId: string, value: FieldValue | null) => Promise<boolean>;
  /** Drops a deleted task's values locally; the server removes its rows. */
  forgetTask: (taskId: string) => void;
}

export function useTaskFields(onError: (message: string) => void): UseTaskFields {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<TaskFieldValues>({});
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const valuesRef = useRef(values);
  const valueQueue = useRef(new LatestValueQueue<FieldValue | null | undefined>());
  const updateValues = useCallback((update: (current: TaskFieldValues) => TaskFieldValues) => {
    const next = update(valuesRef.current);
    valuesRef.current = next;
    setValues(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fieldApi.listFields(), fieldApi.listValues()])
      .then(([defs, rows]) => {
        if (cancelled) return;
        const map: TaskFieldValues = {};
        for (const row of rows) {
          if (row.value === null) continue;
          (map[row.taskId] ??= {})[row.fieldId] = row.value;
        }
        setFields([...defs].sort(byOrder));
        updateValues(() => map);
        setOnline(true);
      })
      .catch(() => { if (!cancelled) setOnline(false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [updateValues]);

  const createField = useCallback(async (input: FieldInput) => {
    try {
      const created = await fieldApi.createField(input);
      setFields((prev) => [...prev, created].sort(byOrder));
      return created;
    } catch (e) {
      onError(errorMessage(e, "Couldn't create the field"));
      return null;
    }
  }, [onError]);

  const updateField = useCallback(async (id: string, input: FieldInput) => {
    try {
      const saved = await fieldApi.updateField(id, input);
      setFields((prev) => prev.map((f) => (f.id === id ? saved : f)).sort(byOrder));
      // A removed option no longer counts as a value.
      if (saved.kind === 'select' || saved.kind === 'multi') {
        const keep = new Set(saved.options.map((o) => o.id));
        updateValues((prev) => {
          const next: TaskFieldValues = {};
          for (const [taskId, row] of Object.entries(prev)) {
            const copy = { ...row };
            const v = copy[id];
            if (Array.isArray(v)) {
              const kept = v.filter((x) => keep.has(x));
              if (kept.length) copy[id] = kept; else delete copy[id];
            } else if (typeof v === 'string' && !keep.has(v)) {
              delete copy[id];
            }
            next[taskId] = copy;
          }
          return next;
        });
      }
      return saved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't save the field"));
      return null;
    }
  }, [onError, updateValues]);

  const deleteField = useCallback(async (id: string) => {
    try {
      await fieldApi.deleteField(id);
      setFields((prev) => prev.filter((f) => f.id !== id));
      updateValues((prev) => {
        const next: TaskFieldValues = {};
        for (const [taskId, row] of Object.entries(prev)) {
          const { [id]: _removed, ...rest } = row;
          next[taskId] = rest;
        }
        return next;
      });
      return true;
    } catch (e) {
      onError(errorMessage(e, "Couldn't delete the field"));
      return false;
    }
  }, [onError, updateValues]);

  const setValue = useCallback(async (taskId: string, fieldId: string, value: FieldValue | null) => {
    const before = valuesRef.current[taskId]?.[fieldId];
    const apply = (v: FieldValue | null | undefined) => updateValues((current) => {
      const row = { ...(current[taskId] ?? {}) };
      if (v === null || v === undefined) delete row[fieldId]; else row[fieldId] = v;
      return { ...current, [taskId]: row };
    });
    return valueQueue.current.submit(
      `${taskId}:${fieldId}`,
      before,
      value,
      async () => (await fieldApi.setValue(taskId, fieldId, value)).value,
      apply,
      () => onError("Couldn't save the value"),
    );
  }, [onError, updateValues]);

  const forgetTask = useCallback((taskId: string) => {
    updateValues((prev) => {
      if (!prev[taskId]) return prev;
      const { [taskId]: _removed, ...rest } = prev;
      return rest;
    });
  }, [updateValues]);

  return { fields, values, online, loading, createField, updateField, deleteField, setValue, forgetTask };
}
