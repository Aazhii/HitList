/**
 * The databases hook: what it holds, what it does when the server cannot be
 * reached, and that a slow answer for a closed database never lands.
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDatabases, type UseDatabases } from '@/hooks/useDatabases';
import { databaseApi, type ApiDatabase, type ApiDatabaseRow } from '@/lib/api';

const db = (over: Partial<ApiDatabase> = {}): ApiDatabase => ({
  id: 'db1', name: 'Reading list', icon: '📚', dateFieldId: '', dbOrder: 0, createdAt: 1, updatedAt: 1, ...over,
});
const record = (over: Partial<ApiDatabaseRow> = {}): ApiDatabaseRow => ({
  id: 'r1', databaseId: 'db1', title: 'Dune', rowOrder: 0, createdAt: 1, updatedAt: 1, ...over,
});

/** Renders the hook and exposes its latest value. */
function mount(openId: string | null, onError = vi.fn()) {
  const seen: { current: UseDatabases | null } = { current: null };
  function Harness({ open }: { open: string | null }) {
    seen.current = useDatabases(open, onError);
    return null;
  }
  const utils = render(<Harness open={openId} />);
  return { seen, onError, rerender: (open: string | null) => utils.rerender(<Harness open={open} />) };
}

beforeEach(() => {
  vi.spyOn(databaseApi, 'list').mockResolvedValue([db({ id: 'b', dbOrder: 1 }), db({ id: 'a', dbOrder: 0 })]);
  vi.spyOn(databaseApi, 'listRows').mockResolvedValue([record()]);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('useDatabases', () => {
  it('lists databases in their order once the server answers', async () => {
    const { seen } = mount(null);
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    expect(seen.current?.online).toBe(true);
    expect(seen.current?.databases.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('holds nothing and says so when the server cannot be reached', async () => {
    vi.spyOn(databaseApi, 'list').mockRejectedValue(new Error('offline'));
    const { seen } = mount(null);
    await waitFor(() => expect(seen.current?.loading).toBe(false));
    expect(seen.current?.online).toBe(false);
    expect(seen.current?.databases).toEqual([]);
  });

  it('loads the open database\'s records, and clears them when none is open', async () => {
    const { seen, rerender } = mount('db1');
    await waitFor(() => expect(seen.current?.rows.map((r) => r.id)).toEqual(['r1']));

    act(() => rerender(null));
    await waitFor(() => expect(seen.current?.rows).toEqual([]));
  });

  it('drops a slow answer for a database that is no longer open', async () => {
    let settleFirst: (rows: ApiDatabaseRow[]) => void = () => {};
    vi.spyOn(databaseApi, 'listRows')
      .mockImplementationOnce(() => new Promise((resolve) => { settleFirst = resolve; }))
      .mockResolvedValueOnce([record({ id: 'second', databaseId: 'db2' })]);

    const { seen, rerender } = mount('db1');
    act(() => rerender('db2'));
    await waitFor(() => expect(seen.current?.rows.map((r) => r.id)).toEqual(['second']));

    // The first database finally answers; it must not replace what is open.
    await act(async () => { settleFirst([record({ id: 'late' })]); });
    expect(seen.current?.rows.map((r) => r.id)).toEqual(['second']);
  });

  it('adds, saves and removes a record in the open database', async () => {
    vi.spyOn(databaseApi, 'createRow').mockResolvedValue(record({ id: 'r2', title: 'Ubik', rowOrder: 1 }));
    vi.spyOn(databaseApi, 'updateRow').mockResolvedValue(record({ id: 'r1', title: 'Dune (2021)' }));
    vi.spyOn(databaseApi, 'deleteRow').mockResolvedValue(undefined);

    const { seen } = mount('db1');
    await waitFor(() => expect(seen.current?.rows).toHaveLength(1));

    await act(async () => { await seen.current?.createRow({ title: 'Ubik' }); });
    expect(seen.current?.rows.map((r) => r.id)).toEqual(['r1', 'r2']);

    await act(async () => { await seen.current?.updateRow('r1', { title: 'Dune (2021)' }); });
    expect(seen.current?.rows.find((r) => r.id === 'r1')?.title).toBe('Dune (2021)');

    await act(async () => { await seen.current?.deleteRow('r1'); });
    expect(seen.current?.rows.map((r) => r.id)).toEqual(['r2']);
  });

  it('reports what went wrong instead of throwing', async () => {
    vi.spyOn(databaseApi, 'create').mockRejectedValue({ fields: { name: 'is required' } });
    const { seen, onError } = mount(null);
    await waitFor(() => expect(seen.current?.loading).toBe(false));

    await act(async () => { expect(await seen.current?.createDatabase({ name: '' })).toBeNull(); });
    expect(onError).toHaveBeenCalledWith('Name is required');
  });

  it('takes a deleted database out of the list, with its records', async () => {
    vi.spyOn(databaseApi, 'remove').mockResolvedValue({ ok: true, recordsRemoved: 3 });
    const { seen } = mount('db1');
    await waitFor(() => expect(seen.current?.rows).toHaveLength(1));

    await act(async () => { expect(await seen.current?.deleteDatabase('db1')).toBe(3); });
    expect(seen.current?.rows).toEqual([]);
  });
});
