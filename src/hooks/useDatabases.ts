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

  useEffect(() => {
    let cancelled = false;
    databaseApi.list()
      .then((list) => {
        if (cancelled) return;
        setDatabases([...list].sort(byOrder));
        setOnline(true);
      })
      .catch(() => { if (!cancelled) setOnline(false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // The records of the database that is open, refetched when it changes.
  const requestRef = useRef(0);
  useEffect(() => {
    if (!openDatabaseId) { setRows([]); return; }
    const request = ++requestRef.current;
    setRowsLoading(true);
    databaseApi.listRows(openDatabaseId)
      .then((list) => {
        // A slower answer for a database that is no longer open must not land.
        if (request !== requestRef.current) return;
        setRows([...list].sort(rowsByOrder));
      })
      .catch((e) => {
        if (request !== requestRef.current) return;
        onError(errorMessage(e, "Couldn't load the records"));
      })
      .finally(() => { if (request === requestRef.current) setRowsLoading(false); });
  }, [openDatabaseId, onError]);

  const createDatabase = useCallback(async (input: DatabaseInput) => {
    try {
      const created = await databaseApi.create(input);
      setDatabases((prev) => [...prev, created].sort(byOrder));
      return created;
    } catch (e) {
      onError(errorMessage(e, "Couldn't create the database"));
      return null;
    }
  }, [onError]);

  const updateDatabase = useCallback(async (id: string, input: DatabaseInput) => {
    try {
      const saved = await databaseApi.update(id, input);
      setDatabases((prev) => prev.map((d) => (d.id === id ? saved : d)).sort(byOrder));
      return saved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't save the database"));
      return null;
    }
  }, [onError]);

  const deleteDatabase = useCallback(async (id: string) => {
    try {
      const { recordsRemoved } = await databaseApi.remove(id);
      setDatabases((prev) => prev.filter((d) => d.id !== id));
      if (id === openDatabaseId) setRows([]);
      return recordsRemoved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't delete the database"));
      return null;
    }
  }, [onError, openDatabaseId]);

  const createRow = useCallback(async (input: DatabaseRowInput) => {
    if (!openDatabaseId) return null;
    try {
      const created = await databaseApi.createRow(openDatabaseId, input);
      setRows((prev) => [...prev, created].sort(rowsByOrder));
      return created;
    } catch (e) {
      onError(errorMessage(e, "Couldn't add the record"));
      return null;
    }
  }, [openDatabaseId, onError]);

  const updateRow = useCallback(async (recordId: string, input: DatabaseRowInput) => {
    try {
      const saved = await databaseApi.updateRow(recordId, input);
      setRows((prev) => prev.map((r) => (r.id === recordId ? saved : r)).sort(rowsByOrder));
      return saved;
    } catch (e) {
      onError(errorMessage(e, "Couldn't save the record"));
      return null;
    }
  }, [onError]);

  const deleteRow = useCallback(async (recordId: string) => {
    try {
      await databaseApi.deleteRow(recordId);
      setRows((prev) => prev.filter((r) => r.id !== recordId));
      return true;
    } catch (e) {
      onError(errorMessage(e, "Couldn't delete the record"));
      return false;
    }
  }, [onError]);

  return {
    databases, rows, online, loading, rowsLoading,
    createDatabase, updateDatabase, deleteDatabase, createRow, updateRow, deleteRow,
  };
}
