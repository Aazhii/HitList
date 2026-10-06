import { API_BASE_URL } from '@/lib/api';
import { simpleRequest } from '@/lib/simpleRequest';
import { databaseApi, type ApiTask, type ApiList, type Quadrant } from '@/lib/api';

export type SourceKind = 'note' | 'database';
export interface SharedSource {
  kind: SourceKind;
  id: string;
  recordIds: Record<string, string>;
  fieldIds: Record<string, string>;
}

export interface SourceNoteSummary { id: string; title: string; emoji?: string; updatedAt?: number }

export interface SourceTaskInput {
  workspaceId: string;
  sourceNoteId?: string;
  sourceBlockId?: string;
  sourceRecordId?: string;
  sourceFieldId?: string;
  title: string;
  quadrant: Quadrant;
  listId: string;
  assigneeUserId?: string;
}
export interface SourceTaskResult { task: ApiTask; source: SharedSource }

export async function listSourceLists(workspaceId: string): Promise<ApiList[]> {
  const request = simpleRequest(`${API_BASE_URL}/api/sync/source-lists?${new URLSearchParams({ workspaceId })}`);
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw new Error('Workspace lists unavailable. Try again.');
  return response.json() as Promise<ApiList[]>;
}

export function sourceTaskRequest(input: SourceTaskInput) {
  const body = JSON.stringify({ ...input, clientId: crypto.randomUUID() });
  let saved: SourceTaskResult | undefined;
  let pending: Promise<SourceTaskResult> | undefined;
  return async (): Promise<SourceTaskResult> => {
    if (saved) return saved;
    if (pending) return pending;
    pending = (async () => {
      const request = simpleRequest(`${API_BASE_URL}/api/sync/source-task`, 'POST', body);
      const response = await fetch(request.url, request.init);
      if (!response.ok) throw new Error('Could not confirm task creation. Retry the same assignment safely.');
      saved = await response.json() as SourceTaskResult;
      return saved;
    })();
    try { return await pending; }
    finally { pending = undefined; }
  };
}

export async function listSourceNotes(): Promise<SourceNoteSummary[]> {
  const request = simpleRequest(`${API_BASE_URL}/api/notes`);
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw new Error('Notes unavailable');
  const notes = await response.json() as unknown;
  if (!Array.isArray(notes)) throw new Error('Invalid notes response');
  return notes as SourceNoteSummary[];
}

export async function shareSource(workspaceId: string, kind: SourceKind, id: string): Promise<SharedSource> {
  const request = simpleRequest(`${API_BASE_URL}/api/sync/share-source`, 'POST', JSON.stringify({ workspaceId, kind, id }));
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw new Error('Source could not be shared. Your personal source is unchanged.');
  return response.json() as Promise<SharedSource>;
}

export function sourceLocation(workspaceId: string, kind: SourceKind, id: string, recordId?: string): string {
  const params = new URLSearchParams({ workspace: workspaceId, source: kind, id });
  if (recordId) params.set('record', recordId);
  return `#${params}`;
}

export function readSourceLocation(hash = window.location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const kind = params.get('source');
  const id = params.get('id');
  if ((kind !== 'note' && kind !== 'database' && kind !== 'record') || !id) return null;
  return { workspaceId: params.get('workspace'), kind, id, recordId: params.get('record') };
}

export function assignedSourceLocation(task: Pick<ApiTask, 'sourceNoteId' | 'sourceRecordId'> & { workspaceId: string }): string | null {
  if (task.sourceNoteId) return sourceLocation(task.workspaceId, 'note', task.sourceNoteId);
  if (task.sourceRecordId) return `#${new URLSearchParams({ workspace: task.workspaceId, source: 'record', id: task.sourceRecordId })}`;
  return null;
}

export async function findRecordDatabase(recordId: string): Promise<string | null> {
  for (const database of await databaseApi.list()) {
    const rows = await databaseApi.listRows(database.id);
    if (rows.some((row) => row.id === recordId)) return database.id;
  }
  return null;
}