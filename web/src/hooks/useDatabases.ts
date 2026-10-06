/**
 * The user's databases, and the records of whichever one is open.
 *
 * Databases need the server: unlike tasks and notes there is no offline copy,
 * because a record's columns are field definitions that only the server holds.
 * When it cannot be reached the hook reports `online: false` and holds nothing,
 * so the screen can say the databases are unavailable rather than showing an
 * empty list that looks like they were lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  databaseApi, type ApiDatabase, type ApiDatabaseRow, type DatabaseInput, type DatabaseRowInput,
} from '@/lib/api';
import { flushSourceSaves, sourceWritesPending, sourceWriteVersion, waitForSourceWrites } from '@/lib/sourceSaves';

function errorMessage(e: unknown, fallback: string): string {
  const o = e as { message?: unknown; fields?: Record<string, string> } | null;
  const field = o?.fields ? Object.entries(o.fields)[0] : undefined;
  if (field) return `${field[0] === 'name' ? 'Name' : field[0]} ${field[1]}`;
  return typeof o?.message === 'string' && o.message ? o.message : fallback;
}

const byOrder = (a: ApiDatabase, b: ApiDatabase) => a.dbOrder - b.dbOrder || a.createdAt - b.createdAt;
const rowsByOrder = (a: ApiDatabaseRow, b: ApiDatabaseRow) => a.rowOrder - b.rowOrder || a.createdAt - b.createdAt;

export interface UseDatabases {
  databases: ApiDatabase[];
  rows: ApiDatabaseRow[];
  online: boolean;
  loading: boolean;
  /** True while the open database's records are being fetched. */
  rowsLoading: boolean;
  createDatabase: (input: DatabaseInput) => Promise<ApiDatabase | null>;
  updateDatabase: (id: string, input: DatabaseInput) => Promise<ApiDatabase | null>;
  deleteDatabase: (id: string) => Promise<number | null>;
  createRow: (input: DatabaseRowInput) => Promise<ApiDatabaseRow | null>;
  updateRow: (recordId: string, input: DatabaseRowInput) => Promise<ApiDatabaseRow | null>;
  deleteRow: (recordId: string) => Promise<boolean>;
}

export function useDatabases(openDatabaseId: string | null, onError: (message: string) => void): UseDatabases {
  const [databases, setDatabases] = useState<ApiDatabase[]>([]);
  const [rows, setRows] = useState<ApiDatabaseRow[]>([]);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const mutation = useRef(0);
  const pendingMutations = useRef(new Set<Promise<unknown>>());
  const mutate = useCallback(async <Result,>(operation: () => Promise<Result>): Promise<Result> => {
    mutation.current++;
    const write = operation();
    pendingMutations.current.add(write);
    try { return await write; }
    finally { pendingMutations.current.delete(write); }
  }, []);
  const waitForWrites = useCallback(async () => {
    do {
      await Promise.allSettled([...pendingMutations.current]);
      await waitForSourceWrites();
    } while (pendingMutations.current.size || sourceWritesPending());
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try { await flushSourceSaves(); if (live) setRevision((value) => value + 1); } catch { /* keep pending edits visible */ }
    };
    window.addEventListener('hitlist:workspace-data-changed', refresh);
    return () => { live = false; window.removeEventListener('hitlist:workspace-data-changed', refresh); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const version = mutation.current;
    const sourceVersion = sourceWriteVersion();
    const startedDuringWrite = sourceWritesPending() || pendingMutations.current.size > 0;
    databaseApi.list()
      .then(async (list) => {
        if (cancelled) return;
        if (startedDuringWrite || version !== mutation.current || sourceVersion !== sourceWriteVersion() || sourceWritesPending()) {
          await waitForWrites();
          if (!cancelled) setRevision(value => value + 1);
          return;
        }
        setDatabases([...list].sort(byOrder));
        setOnline(true);
      })
      .catch(() => { if (!cancelled) setOnline(false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision, waitForWrites]);

  // The records of the database that is open, refetched when it changes.
  const requestRef = useRef(0);
  useEffect(() => {
    const request = ++requestRef.current;
    if (!openDatabaseId) { setRows([]); setRowsLoading(false); return; }
    const version = mutation.current;
    const sourceVersion = sourceWriteVersion();
    const startedDuringWrite = sourceWritesPending() || pendingMutations.current.size > 0;
    setRowsLoading(true);
    databaseApi.listRows(openDatabaseId)
      .then(async (list) => {
        // A slower answer for a database that is no longer open must not land.
        if (request !== requestRef.current) return;
        if (startedDuringWrite || version !== mutation.current || sourceVersion !== sourceWriteVersion() || sourceWritesPending()) {
          await waitForWrites();
          if (request === requestRef.current) setRevision(value => value + 1);
          return;
        }
        setRows([...list].sort(rowsByOrder));
      })
      .catch((e) => {
        if (request !== requestRef.current) return;
        onError(errorMessage(e, "Couldn't load the records"));
      })
      .finally(() => { if (request === requestRef.current) setRowsLoading(false); });
    return () => { requestRef.current++; };
  }, [openDatabaseId, onError, revision, waitForWrites]);

  const createDatabase = useCallback(async (input: DatabaseInput) => {
    try {
      const created = await mutate(() => databaseApi.create(input));
      setDatabases((prev) => [...prev, created].sort(byOrder));
      return created;
    } catch (e) {
      onError(errorMessage(e, "Couldn't create the database"));
      return null;
    }
  }, [onError, mutate]);

  const updateDatabase = useCallback(async (id: string, input: DatabaseInput) => {
    try {
      const saved = await mutate(() => databaseApi.update(id, input));
      setDatabases((prev) => prev.map((d) => (d.id === id ? saved : d)).sort(byOrder));
      return saved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't save the database"));
      return null;
    }
  }, [onError, mutate]);

  const deleteDatabase = useCallback(async (id: string) => {
    try {
      const { recordsRemoved } = await mutate(() => databaseApi.remove(id));
      setDatabases((prev) => prev.filter((d) => d.id !== id));
      if (id === openDatabaseId) setRows([]);
      return recordsRemoved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't delete the database"));
      return null;
    }
  }, [onError, openDatabaseId, mutate]);

  const createRow = useCallback(async (input: DatabaseRowInput) => {
    if (!openDatabaseId) return null;
    try {
      const created = await mutate(() => databaseApi.createRow(openDatabaseId, input));
      setRows((prev) => [...prev, created].sort(rowsByOrder));
      return created;
    } catch (e) {
      onError(errorMessage(e, "Couldn't add the record"));
      return null;
    }
  }, [openDatabaseId, onError, mutate]);

  const updateRow = useCallback(async (recordId: string, input: DatabaseRowInput) => {
    try {
      const saved = await mutate(() => databaseApi.updateRow(recordId, input));
      setRows((prev) => prev.map((r) => (r.id === recordId ? saved : r)).sort(rowsByOrder));
      return saved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't save the record"));
      return null;
    }
  }, [onError, mutate]);

  const deleteRow = useCallback(async (recordId: string) => {
    try {
      await mutate(() => databaseApi.deleteRow(recordId));
      setRows((prev) => prev.filter((r) => r.id !== recordId));
      return true;
    } catch (e) {
      onError(errorMessage(e, "Couldn't delete the record"));
      return false;
    }
  }, [onError, mutate]);

  return {
    databases, rows, online, loading, rowsLoading,
    createDatabase, updateDatabase, deleteDatabase, createRow, updateRow, deleteRow,
  };
}
