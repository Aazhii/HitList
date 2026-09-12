/**
 * catalystApi.ts — Catalyst DataStore CRUD mapped to ApiTask/ApiList shapes
 *
 * Tables:
 *   KaizenTasks  (table_id: 69251000000040299)
 *   KaizenLists  (table_id: 69251000000052271)
 *
 * Row scoping: filter by CREATORID (Catalyst auto-populates this with the
 * authenticated user's ID). OwnerId is kept as a redundant custom column for
 * legacy rows, but CREATORID is the authoritative filter.
 *
 * SDK v4 DataStore API (CORRECTED):
 *   catalyst.datastore().table(name).insertRow(data)           → { content, status }
 *     - data must NOT include ROWID, CREATORID, CREATEDTIME, MODIFIEDTIME
 *   catalyst.datastore().table(name).updateRow(rowId, data)    → { content, status }
 *     - rowId is the FIRST argument; data must NOT include ROWID or system columns
 *   catalyst.datastore().table(name).deleteRow(rowId)          → { content, status }
 *   catalyst.datastore().table(name).getPagedRows()            → { content[], more_records, next_token }
 */

import { getAllRows, getTable, unwrapRow } from './catalystClient';
import type {
  ApiTask, ApiList, ApiMomentumStats,
  TaskCreateRequest, TaskUpdateRequest,
  ListCreateRequest, ListUpdateRequest,
} from './api';
import { computeMomentum } from './statsUtils';

// ── Row → ApiTask ─────────────────────────────────────────────────────────────

function rowToApiTask(row: Record<string, unknown>): ApiTask {
  const now = new Date().toISOString();
  return {
    id: String(row['ROWID'] ?? ''),
    title: String(row['Title'] ?? ''),
    status: (String(row['Status'] ?? 'TODO')) as ApiTask['status'],
    quadrant: (String(row['Quadrant'] ?? 'SCHEDULE')) as ApiTask['quadrant'],
    priority: (row['TaskPriority'] as ApiTask['priority']) ?? null,
    note: row['Note'] ? String(row['Note']) : null,
    dueDate: row['DueDate'] ? String(row['DueDate']) : null,
    dueTime: row['DueTime'] ? String(row['DueTime']) : null,
    category: row['Category'] ? String(row['Category']) : null,
    listId: row['ListId'] ? String(row['ListId']) : null,
    taskOrder: row['TaskOrder'] ? Number(row['TaskOrder']) : 0,
    reminderEnabled: row['ReminderEnabled'] === 'true',
    reminderMinutesBefore: row['ReminderMinutesBefore'] ? Number(row['ReminderMinutesBefore']) : null,
    completedAt: row['CompletedAt'] ? String(row['CompletedAt']) : null,
    createdAt: row['CreatedAt'] ? String(row['CreatedAt']) : now,
    updatedAt: row['UpdatedAt'] ? String(row['UpdatedAt']) : now,
  };
}

// ── Row → ApiList ─────────────────────────────────────────────────────────────

function rowToApiList(row: Record<string, unknown>): ApiList {
  const now = new Date().toISOString();
  return {
    id: String(row['ROWID'] ?? ''),
    name: String(row['Name'] ?? 'Unnamed List'),
    color: String(row['Color'] ?? 'emerald'),
    listOrder: row['ListOrder'] ? Number(row['ListOrder']) : 0,
    createdAt: row['CreatedAt'] ? String(row['CreatedAt']) : now,
    updatedAt: row['UpdatedAt'] ? String(row['UpdatedAt']) : now,
  };
}

// ── Task API ──────────────────────────────────────────────────────────────────

export const catalystTaskApi = {
  /**
   * Lists tasks for the authenticated user.
   *
   * Scoping strategy (layered, most-specific first):
   *   1. UserRowId — DataStore ROWID from KaizenUsers table (most reliable, explicit FK)
   *   2. CREATORID — Catalyst auto-populated system column (reliable on Catalyst hosting)
   *   3. OwnerId   — Legacy custom column kept for backward compat with older rows
   *
   * @param ownerId    Catalyst user_id (from isUserAuthenticated)
   * @param userRowId  KaizenUsers ROWID (from upsertCurrentUser) — optional, used when available
   */
  async list(ownerId: string, userRowId?: string | null): Promise<ApiTask[]> {
    const rows = await getAllRows('KaizenTasks');
    return rows
      .filter((r) => {
        // If we have a UserRowId, prefer it as the primary scope filter
        if (userRowId) {
          return (
            String(r['UserRowId']) === userRowId ||
            // Also accept rows scoped by CREATORID or OwnerId (legacy / rows created before UserRowId was added)
            String(r['CREATORID']) === ownerId ||
            String(r['OwnerId']) === ownerId
          );
        }
        // Fallback: CREATORID or OwnerId
        return String(r['CREATORID']) === ownerId || String(r['OwnerId']) === ownerId;
      })
      .map(rowToApiTask);
  },

  async todayHistory(ownerId: string, listId?: string, userRowId?: string | null): Promise<ApiTask[]> {
    const tasks = await catalystTaskApi.list(ownerId, userRowId);
    const today = new Date();
    const isToday = (iso: string | null) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
    };
    return tasks
      .filter((t) => t.status === 'DONE' && isToday(t.completedAt ?? t.createdAt))
      .filter((t) => !listId || t.listId === listId)
      .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime());
  },

  async create(ownerId: string, req: TaskCreateRequest, userRowId?: string | null): Promise<ApiTask> {
    const now = new Date().toISOString();
    const table = getTable('KaizenTasks');
    const data: Record<string, unknown> = {
      OwnerId: ownerId,
      Title: req.title,
      Status: req.status ?? 'TODO',
      Quadrant: req.quadrant ?? 'SCHEDULE',
      TaskPriority: req.priority ?? '',
      Note: req.note ?? '',
      DueDate: req.dueDate ?? '',
      DueTime: req.dueTime ?? '',
      Category: req.category ?? '',
      ListId: req.listId ?? '',
      TaskOrder: String(req.taskOrder ?? 0),
      ReminderEnabled: String(req.reminderEnabled ?? false),
      ReminderMinutesBefore: String(req.reminderMinutesBefore ?? ''),
      CompletedAt: '',
      CreatedAt: now,
      UpdatedAt: now,
    };
    // Include UserRowId (KaizenUsers ROWID) when available for explicit per-user scoping
    if (userRowId) data['UserRowId'] = userRowId;
    try {
      const res = await table.insertRow(data);
      // SDK v4 insertRow returns { content: { KaizenTasks: { ROWID, ... } } }
      // unwrapRow normalises this to a flat row object
      const row = unwrapRow(res.content as Record<string, unknown>, 'KaizenTasks');
      console.debug('[CatalystApi] insertRow (task) response row:', row);
      if (!row['ROWID']) {
        console.error('[CatalystApi] insertRow (task) — ROWID missing in response:', row);
        throw new Error('Task insert succeeded but ROWID was not returned. Update/delete will fail.');
      }
      return rowToApiTask(row);
    } catch (e) {
      console.error('[CatalystApi] insertRow (task) failed:', JSON.stringify(e), e);
      throw e;
    }
  },

  async update(rowId: string, req: TaskUpdateRequest): Promise<ApiTask> {
    const now = new Date().toISOString();
    const table = getTable('KaizenTasks');
    // SDK v4: updateRow(rowId, data) — rowId is first arg, data must NOT include ROWID/system cols
    const data: Record<string, unknown> = { UpdatedAt: now };
    if (req.title !== undefined)                  data['Title'] = req.title;
    if (req.status !== undefined)                 data['Status'] = req.status;
    if (req.quadrant !== undefined)               data['Quadrant'] = req.quadrant;
    if (req.priority !== undefined)               data['TaskPriority'] = req.priority ?? '';
    if (req.note !== undefined)                   data['Note'] = req.note ?? '';
    if (req.dueDate !== undefined)                data['DueDate'] = req.dueDate ?? '';
    if (req.dueTime !== undefined)                data['DueTime'] = req.dueTime ?? '';
    if (req.category !== undefined)               data['Category'] = req.category ?? '';
    if (req.reminderEnabled !== undefined)        data['ReminderEnabled'] = String(req.reminderEnabled);
    if (req.reminderMinutesBefore !== undefined)  data['ReminderMinutesBefore'] = String(req.reminderMinutesBefore ?? '');
    try {
      const res = await table.updateRow(rowId, data);
      // SDK v4 updateRow returns { content: { KaizenTasks: { ROWID, ... } } }
      const row = unwrapRow(res.content as Record<string, unknown>, 'KaizenTasks');
      console.debug('[CatalystApi] updateRow (task) response row:', row);
      return rowToApiTask(row);
    } catch (e) {
      console.error('[CatalystApi] updateRow (task) failed:', JSON.stringify(e), e);
      throw e;
    }
  },

  async updateStatus(rowId: string, status: ApiTask['status']): Promise<ApiTask> {
    const now = new Date().toISOString();
    const table = getTable('KaizenTasks');
    // SDK v4: updateRow(rowId, data) — no ROWID in data
    const data: Record<string, unknown> = { Status: status, UpdatedAt: now };
    if (status === 'DONE') data['CompletedAt'] = now;
    try {
      const res = await table.updateRow(rowId, data);
      const row = unwrapRow(res.content as Record<string, unknown>, 'KaizenTasks');
      return rowToApiTask(row);
    } catch (e) {
      console.error('[CatalystApi] updateStatus failed:', JSON.stringify(e), e);
      throw e;
    }
  },

  async markComplete(rowId: string): Promise<ApiTask> {
    return catalystTaskApi.updateStatus(rowId, 'DONE');
  },

  async reprioritize(rowId: string, quadrant: ApiTask['quadrant']): Promise<ApiTask> {
    const now = new Date().toISOString();
    const table = getTable('KaizenTasks');
    try {
      const res = await table.updateRow(rowId, { Quadrant: quadrant, UpdatedAt: now });
      const row = unwrapRow(res.content as Record<string, unknown>, 'KaizenTasks');
      return rowToApiTask(row);
    } catch (e) {
      console.error('[CatalystApi] reprioritize failed:', JSON.stringify(e), e);
      throw e;
    }
  },

  async delete(rowId: string): Promise<void> {
    if (!rowId || rowId.startsWith('temp-')) {
      console.warn('[CatalystApi] deleteRow skipped — invalid rowId:', rowId);
      return;
    }
    const table = getTable('KaizenTasks');
    // SDK v4: table.deleteRow(rowId) — rowId is the ROWID bigint as string/number
    await table.deleteRow(rowId);
  },
};

// ── List API ──────────────────────────────────────────────────────────────────

export const catalystListApi = {
  /**
   * Lists lists for the authenticated user.
   * Scoping: UserRowId (explicit FK) → CREATORID → OwnerId (legacy).
   */
  async list(ownerId: string, userRowId?: string | null): Promise<ApiList[]> {
    const rows = await getAllRows('KaizenLists');
    return rows
      .filter((r) => {
        if (userRowId) {
          return (
            String(r['UserRowId']) === userRowId ||
            String(r['CREATORID']) === ownerId ||
            String(r['OwnerId']) === ownerId
          );
        }
        return String(r['CREATORID']) === ownerId || String(r['OwnerId']) === ownerId;
      })
      .map(rowToApiList)
      .sort((a, b) => a.listOrder - b.listOrder);
  },

  async create(ownerId: string, req: ListCreateRequest, userRowId?: string | null): Promise<ApiList> {
    const now = new Date().toISOString();
    const table = getTable('KaizenLists');
    const data: Record<string, unknown> = {
      OwnerId: ownerId,
      Name: req.name,
      Color: req.color ?? 'emerald',
      ListOrder: String(req.listOrder ?? 0),
      CreatedAt: now,
      UpdatedAt: now,
    };
    // Include UserRowId (KaizenUsers ROWID) when available for explicit per-user scoping
    if (userRowId) data['UserRowId'] = userRowId;
    try {
      const res = await table.insertRow(data);
      // SDK v4 insertRow returns { content: { KaizenLists: { ROWID, ... } } }
      const row = unwrapRow(res.content as Record<string, unknown>, 'KaizenLists');
      console.debug('[CatalystApi] insertRow (list) response row:', row);
      return rowToApiList(row);
    } catch (e) {
      console.error('[CatalystApi] insertRow (list) failed:', JSON.stringify(e), e);
      throw e;
    }
  },

  async update(rowId: string, req: ListUpdateRequest): Promise<ApiList> {
    const now = new Date().toISOString();
    const table = getTable('KaizenLists');
    // SDK v4: updateRow(rowId, data) — rowId is first arg, no ROWID in data
    const data: Record<string, unknown> = { UpdatedAt: now };
    if (req.name !== undefined)  data['Name'] = req.name;
    if (req.color !== undefined) data['Color'] = req.color;
    try {
      const res = await table.updateRow(rowId, data);
      // SDK v4 updateRow returns { content: { KaizenLists: { ROWID, ... } } }
      const row = unwrapRow(res.content as Record<string, unknown>, 'KaizenLists');
      return rowToApiList(row);
    } catch (e) {
      console.error('[CatalystApi] updateRow (list) failed:', JSON.stringify(e), e);
      throw e;
    }
  },

  async delete(rowId: string): Promise<void> {
    if (!rowId || rowId.startsWith('temp-')) {
      console.warn('[CatalystApi] deleteRow (list) skipped — invalid rowId:', rowId);
      return;
    }
    const table = getTable('KaizenLists');
    await table.deleteRow(rowId);
  },
};

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function catalystMomentum(
  ownerId: string,
  listId?: string,
  storedStreak = 0,
): Promise<ApiMomentumStats> {
  const tasks = await catalystTaskApi.list(ownerId);
  return computeMomentum(tasks, listId, storedStreak);
}
