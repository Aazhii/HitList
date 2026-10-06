import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseApi, fieldApi, type ApiDatabase } from '@/lib/api';
import { trackSourceWrite } from '@/lib/sourceSaves';
import { DatabaseWorkspace, type DatabaseStore, type RecordValues } from '@/components/databases/DatabaseWorkspace';
import type { FieldDef } from '@/types/fields';

vi.mock('@/hooks/useSavedViews', () => ({ useSavedViews: () => ({ views: [] }) }));
vi.mock('@/components/databases/RecordTable', async original => ({
  ...await original<typeof import('@/components/databases/RecordTable')>(),
  RecordTable: ({ fields, values }: { fields: FieldDef[]; values: RecordValues }) => (
    <output data-testid="records">{JSON.stringify({ fields, values })}</output>
  ),
}));

const database: ApiDatabase = {
  id: 'db1', name: 'Database', icon: '', dateFieldId: '', titleLabel: 'Title', dbOrder: 0, createdAt: 1, updatedAt: 1,
};
const field: FieldDef = {
  id: 'f1', name: 'Remote column', kind: 'text', options: [], fieldOrder: 0, showOnCard: false, createdAt: 1, updatedAt: 1,
};
const store: DatabaseStore = {
  rows: [], rowsLoading: false, createRow: vi.fn(), updateRow: vi.fn(), deleteRow: vi.fn(), updateDatabase: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(fieldApi, 'listFields').mockResolvedValue([field]);
  vi.spyOn(databaseApi, 'listFieldValues').mockResolvedValue([{ recordId: 'r1', fieldId: 'f1', value: 'Remote value' }]);
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('database field/value refresh', () => {
  it('retries after pending writes settle and stops fetching while idle', async () => {
    let release!: () => void;
    const write = trackSourceWrite(new Promise<void>(resolve => { release = resolve; }));
    render(<DatabaseWorkspace database={database} store={store} />);
    await act(async () => { await Promise.resolve(); });
    expect(fieldApi.listFields).toHaveBeenCalledTimes(1);
    expect(databaseApi.listFieldValues).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('records')).not.toHaveTextContent('Remote value');
    await act(async () => { release(); await write; });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('Remote value'));
    expect(screen.getByTestId('records')).toHaveTextContent('Remote column');
    expect(fieldApi.listFields).toHaveBeenCalledTimes(2);
    expect(databaseApi.listFieldValues).toHaveBeenCalledTimes(2);
    await act(async () => { await Promise.resolve(); });
    expect(fieldApi.listFields).toHaveBeenCalledTimes(2);
  });

  it('retries a response invalidated by a write that has already settled', async () => {
    let answer!: (fields: FieldDef[]) => void;
    vi.mocked(fieldApi.listFields).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    render(<DatabaseWorkspace database={database} store={store} />);
    await act(async () => { await trackSourceWrite(Promise.resolve()); });
    await act(async () => { answer([{ ...field, name: 'Stale column' }]); });
    await waitFor(() => expect(screen.getByTestId('records')).toHaveTextContent('Remote column'));
    expect(screen.getByTestId('records')).not.toHaveTextContent('Stale column');
    expect(fieldApi.listFields).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unmounted workspace when writes settle', async () => {
    let release!: () => void;
    const write = trackSourceWrite(new Promise<void>(resolve => { release = resolve; }));
    const { unmount } = render(<DatabaseWorkspace database={database} store={store} />);
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { release(); await write; });
    expect(fieldApi.listFields).toHaveBeenCalledTimes(1);
    expect(databaseApi.listFieldValues).toHaveBeenCalledTimes(1);
  });
});