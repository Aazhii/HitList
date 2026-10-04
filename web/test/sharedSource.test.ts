import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignedSourceLocation, findRecordDatabase, listSourceLists, readSourceLocation, shareSource, sourceLocation, sourceTaskRequest } from '@/lib/sharedSource';
import { databaseApi } from '@/lib/api';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('canonical shared sources', () => {
  it('loads target lists without changing the active workspace', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'team-list' }] });
    vi.stubGlobal('fetch', fetcher);
    expect(await listSourceLists('team & 1')).toEqual([{ id: 'team-list' }]);
    expect(fetcher.mock.calls[0][0]).toContain('workspaceId=team+%26+1');
    expect(fetcher.mock.calls[0][1].headers ?? {}).not.toHaveProperty('X-Hitlist-Workspace');
  });

  it('retries with the same client ID and never recreates a saved task', async () => {
    const result = { task: { id: 'task' }, source: { kind: 'note', id: 'canonical', recordIds: {}, fieldIds: {} } };
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal('fetch', fetcher);
    const retry = sourceTaskRequest({ workspaceId: 'team', sourceNoteId: 'personal', sourceBlockId: 'block', title: 'Work', quadrant: 'DO', listId: 'list', assigneeUserId: 'buddy' });
    await expect(retry()).rejects.toThrow('network');
    expect(await retry()).toEqual(result);
    expect(await retry()).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ assigneeUserId: 'buddy', clientId: expect.any(String) });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty('assignedBy');
  });

  it('sends only the selected personal source and preserves canonical mappings', async () => {
    const canonical = { kind: 'database', id: 'canonical', recordIds: { old: 'new' }, fieldIds: { field: 'shared-field' } };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => canonical });
    vi.stubGlobal('fetch', fetcher);
    expect(await shareSource('team', 'database', 'personal')).toEqual(canonical);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ workspaceId: 'team', kind: 'database', id: 'personal' });
  });

  it('round trips workspace, canonical source and record IDs', () => {
    expect(readSourceLocation(sourceLocation('team', 'database', 'db & 1', 'row'))).toEqual({
      workspaceId: 'team', kind: 'database', id: 'db & 1', recordId: 'row',
    });
    expect(readSourceLocation('#source=note')).toBeNull();
  });

  it('does not navigate or return a personal copy on failed sharing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(shareSource('team', 'note', 'personal')).rejects.toThrow('personal source is unchanged');
  });

  it('routes assigned sources with their workspace and resolves records only in the active partition', async () => {
    expect(readSourceLocation(assignedSourceLocation({ workspaceId: 'team', sourceNoteId: 'canonical' })!)).toMatchObject({ workspaceId: 'team', kind: 'note', id: 'canonical' });
    expect(readSourceLocation(assignedSourceLocation({ workspaceId: 'team', sourceRecordId: 'row' })!)).toMatchObject({ workspaceId: 'team', kind: 'record', id: 'row' });
    expect(assignedSourceLocation({ workspaceId: 'team' })).toBeNull();
    vi.spyOn(databaseApi, 'list').mockResolvedValue([{ id: 'db' } as Awaited<ReturnType<typeof databaseApi.list>>[number]]);
    vi.spyOn(databaseApi, 'listRows').mockResolvedValue([{ id: 'row' } as Awaited<ReturnType<typeof databaseApi.listRows>>[number]]);
    expect(await findRecordDatabase('row')).toBe('db');
    expect(await findRecordDatabase('missing')).toBeNull();
  });
});