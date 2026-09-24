/**
 * Databases: records that are not tasks.
 *
 * The left column lists the databases; the main area is the open one's records
 * as a table — Title, then a column per field of that database. Everything
 * edits in place, as the tasks table does.
 *
 * What a database deliberately does not have: reminders, escalation and
 * automations. Those are built on tasks, and the page says so rather than
 * offering something that would quietly never fire.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextSectionHeader,
  ViewLayout,
  contextIconButton,
  contextRowClass,
} from '@/components/shell/ViewLayout';
import { TopBar, TopBarToggle, topBarPrimary } from '@/components/shell/TopBar';
import { FieldsManagerDialog, anchorRectOf, type AnchorRect } from '@/components/fields/FieldsManager';
import { RecordTable } from '@/components/databases/RecordTable';
import { RecordBoard } from '@/components/databases/RecordBoard';
import { useDatabases } from '@/hooks/useDatabases';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { fieldApi, databaseApi, type ApiDatabase, type FieldInput } from '@/lib/api';
import { LatestValueQueue } from '@/lib/latestValueQueue';
import { FIELD_EMPTY, isGroupableField } from '@/lib/taskFilters';
import type { FieldDef, FieldValue } from '@/types/fields';

/**
 * The control that was just clicked, for a popover opened from a menu item —
 * by the time the handler runs, focus is still on it.
 */
function activeAnchor(): AnchorRect | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? anchorRectOf(el) : null;
}

/** recordId → fieldId → value, the same shape tasks use. */
export type RecordValues = Record<string, Record<string, FieldValue>>;

export interface DatabasesPageProps {
  /** A database the calendar asked to open. */
  openDatabaseId?: string | null;
  onOpenHandled?: () => void;
  /** Reports which database is on screen, so Back/refresh can return to it. */
  onOpenChange?: (databaseId: string | null) => void;
}

export function DatabasesPage({ openDatabaseId, onOpenHandled, onOpenChange }: DatabasesPageProps = {}) {
  const notify = useCallback((message: string) => toast.error(message, { duration: 3000 }), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const {
    databases, rows, online, loading, rowsLoading,
    createDatabase, updateDatabase, deleteDatabase, createRow, updateRow, deleteRow,
  } = useDatabases(openId, notify);

  /**
   * Which view each database opens in, and the field its board groups by. Per
   * database and per device: a database's views are not saved views yet.
   */
  const [viewByDatabase, setViewByDatabase] = useLocalStorage<Record<string, 'table' | 'board'>>('hitlist-db-view-v1', {});
  const [boardFieldByDatabase, setBoardFieldByDatabase] = useLocalStorage<Record<string, string>>('hitlist-db-board-field-v1', {});

  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<RecordValues>({});
  const valuesRef = useRef<RecordValues>({});
  const valueQueue = useRef(new LatestValueQueue<FieldValue | null | undefined>());
  const updateValues = useCallback((update: (current: RecordValues) => RecordValues) => {
    const next = update(valuesRef.current);
    valuesRef.current = next;
    setValues(next);
  }, []);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fieldsTarget, setFieldsTarget] = useState<{ fieldId?: string; startNew?: boolean }>({});
  /** Where the fields popover hangs from — the control that opened it. */
  const [fieldsAnchor, setFieldsAnchor] = useState<AnchorRect | null>(null);

  const open = databases.find((d) => d.id === openId) ?? null;
  const view = (openId && viewByDatabase[openId]) || 'table';
  const boardField = openId
    ? fields.find((f) => f.id === boardFieldByDatabase[openId] && isGroupableField(f)) ?? null
    : null;


  // Open the first database once they arrive, so the page is never blank when
  // there is something to show.
  useEffect(() => {
    if (!openId && databases.length > 0) setOpenId(databases[0].id);
  }, [databases, openId]);

  // The calendar can send us to the database a record belongs to.
  useEffect(() => {
    if (!openDatabaseId) return;
    setOpenId(openDatabaseId);
    onOpenHandled?.();
  }, [openDatabaseId, onOpenHandled]);

  useEffect(() => { onOpenChange?.(openId); }, [openId, onOpenChange]);

  // This database's fields and values. Both are the server's: a record's
  // columns are field definitions, and there is no offline copy of those.
  useEffect(() => {
    if (!openId) { setFields([]); updateValues(() => ({})); return; }
    let cancelled = false;
    Promise.all([fieldApi.listFields(openId), databaseApi.listFieldValues(openId)])
      .then(([defs, rawValues]) => {
        if (cancelled) return;
        setFields([...defs].sort((a, b) => a.fieldOrder - b.fieldOrder || a.createdAt - b.createdAt));
        const map: RecordValues = {};
        for (const row of rawValues) {
          if (row.value === null) continue;
          (map[row.recordId] ??= {})[row.fieldId] = row.value;
        }
        updateValues(() => map);
      })
      .catch(() => { if (!cancelled) notify("Couldn't load this database's columns"); });
    return () => { cancelled = true; };
  }, [openId, notify, updateValues]);

  const setValue = useCallback(async (recordId: string, fieldId: string, value: FieldValue | null) => {
    const before = valuesRef.current[recordId]?.[fieldId];
    const apply = (v: FieldValue | null | undefined) => updateValues((current) => {
      const row = { ...(current[recordId] ?? {}) };
      if (v === null || v === undefined) delete row[fieldId]; else row[fieldId] = v;
      return { ...current, [recordId]: row };
    });
    await valueQueue.current.submit(
      `${recordId}:${fieldId}`,
      before,
      value,
      async () => (await databaseApi.setFieldValue(recordId, fieldId, value)).value,
      apply,
      () => notify("Couldn't save the value"),
    );
  }, [notify, updateValues]);

  /** "+ Add" in a board column: create the record, then give it that column's value. */
  const addRecordInColumn = useCallback(async (title: string, columnKey: string) => {
    const created = await createRow({ title });
    if (!created || !boardField || !columnKey) return;
    const value: FieldValue | null =
      columnKey === FIELD_EMPTY ? null
      : boardField.kind === 'checkbox' ? true
      : boardField.kind === 'multi' ? [columnKey]
      : columnKey;
    await setValue(created.id, boardField.id, value);
  }, [createRow, boardField, setValue]);

  const handleCreateField = useCallback(async (input: FieldInput) => {
    if (!openId) return null;
    try {
      const created = await fieldApi.createField(input, openId);
      setFields((prev) => [...prev, created].sort((a, b) => a.fieldOrder - b.fieldOrder));
      return created;
    } catch {
      notify("Couldn't create the column");
      return null;
    }
  }, [openId, notify]);

  const handleUpdateField = useCallback(async (id: string, input: FieldInput) => {
    try {
      const saved = await fieldApi.updateField(id, input);
      setFields((prev) => prev.map((f) => (f.id === id ? saved : f)));
      return saved;
    } catch {
      notify("Couldn't save the column");
      return null;
    }
  }, [notify]);

  const handleDeleteField = useCallback(async (id: string) => {
    try {
      await fieldApi.deleteField(id);
      setFields((prev) => prev.filter((f) => f.id !== id));
      updateValues((prev) => Object.fromEntries(
        Object.entries(prev).map(([recordId, row]) => {
          const { [id]: _gone, ...rest } = row;
          return [recordId, rest];
        }),
      ));
      return true;
    } catch {
      notify("Couldn't delete the column");
      return false;
    }
  }, [notify, updateValues]);

  const subtitle = useMemo(() => {
    if (!open) return 'Records that are not tasks';
    const count = rows.length;
    return `${count} record${count === 1 ? '' : 's'} · ${fields.length} column${fields.length === 1 ? '' : 's'}`;
  }, [open, rows.length, fields.length]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ViewLayout
        contextLabel="Databases"
        context={
          <DatabaseList
            databases={databases}
            openId={openId}
            online={online}
            loading={loading}
            onOpen={setOpenId}
            onCreate={createDatabase}
            onRename={(database, name) => { void updateDatabase(database.id, { name, icon: database.icon }); }}
            onDelete={async (database) => {
              const removed = await deleteDatabase(database.id);
              if (removed === null) return;
              if (database.id === openId) setOpenId(null);
              toast(`Deleted "${database.name}"`, {
                description: removed ? `${removed} record${removed === 1 ? '' : 's'} went with it` : undefined,
                duration: 2500,
              });
            }}
          />
        }
        topBar={
          <TopBar
            title={open ? `${open.icon ? `${open.icon} ` : ''}${open.name}` : 'Databases'}
            subtitle={subtitle}
            actions={open ? (
              <button
                type="button"
                onClick={(e) => { setFieldsAnchor(anchorRectOf(e.currentTarget)); setFieldsTarget({ startNew: true }); setFieldsOpen(true); }}
                className={topBarPrimary}
                aria-label="New column"
              >
                <Plus className="size-[15px]" strokeWidth={2.75} aria-hidden />
                <span className="hidden sm:inline">New column</span>
              </button>
            ) : undefined}
          />
        }
      >
        <div className="px-4 py-[22px] md:px-[26px]">
          {!online && !loading ? (
            <EmptyNote
              title="Databases need the server"
              body="A record's columns are field definitions the server holds, so there is no offline copy. Try again when it is reachable."
            />
          ) : loading ? null : databases.length === 0 ? (
            <EmptyNote
              title="No databases yet"
              body="A database keeps records that are not tasks — a reading list, clients, anything with its own columns. Make one in the column on the left."
            />
          ) : !open ? null : (
            <>
              <div className="mb-4 flex">
                <TopBarToggle
                  label="Table or board"
                  value={view}
                  onChange={(next) => setViewByDatabase((prev) => ({ ...prev, [open.id]: next }))}
                  options={[
                    { value: 'table' as const, label: 'Table' },
                    { value: 'board' as const, label: 'Board' },
                  ]}
                />
              </div>

              {view === 'board' ? (
                <RecordBoard
                  rows={rows}
                  fields={fields}
                  values={values}
                  groupField={boardField}
                  onGroupFieldChange={(fieldId) => setBoardFieldByDatabase((prev) => ({ ...prev, [open.id]: fieldId }))}
                  onManageFields={() => { setFieldsAnchor(activeAnchor()); setFieldsTarget({ startNew: true }); setFieldsOpen(true); }}
                  onSetValue={(recordId, fieldId, value) => { void setValue(recordId, fieldId, value); }}
                  onAdd={(title, columnKey) => { void addRecordInColumn(title, columnKey); }}
                />
              ) : (
              <RecordTable
                rows={rows}
                fields={fields}
                values={values}
                loading={rowsLoading}
                onAdd={(title) => { void createRow({ title }); }}
                onRename={(recordId, title) => { void updateRow(recordId, { title }); }}
                onDelete={(recordId) => { void deleteRow(recordId); }}
                onSetValue={(recordId, fieldId, value) => { void setValue(recordId, fieldId, value); }}
                onEditField={(fieldId) => { setFieldsAnchor(activeAnchor()); setFieldsTarget({ fieldId }); setFieldsOpen(true); }}
                onDeleteField={(fieldId) => { void handleDeleteField(fieldId); }}
                onCreateField={() => { setFieldsAnchor(activeAnchor()); setFieldsTarget({ startNew: true }); setFieldsOpen(true); }}
              />
              )}

              <p className="mt-6 text-[12.5px] leading-relaxed text-a-faint">
                Records have no reminders, escalation or automations — those are built on tasks.
                Keep anything that needs chasing as a task.
              </p>
            </>
          )}
        </div>
      </ViewLayout>

      <FieldsManagerDialog
        open={fieldsOpen}
        anchor={fieldsAnchor}
        onOpenChange={setFieldsOpen}
        fields={fields}
        initialFieldId={fieldsTarget.fieldId ?? null}
        startNew={fieldsTarget.startNew ?? false}
        onCreate={handleCreateField}
        onUpdate={handleUpdateField}
        onDelete={handleDeleteField}
      />
    </div>
  );
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-[460px] flex-col items-center py-16 text-center animate-fade-in">
      <Table2 className="mb-3 size-6 text-a-faint" strokeWidth={2.25} aria-hidden />
      <p className="font-display text-[20px] text-a-ink">{title}</p>
      <p className="mt-2 text-[14px] leading-relaxed text-a-muted">{body}</p>
    </div>
  );
}

interface DatabaseListProps {
  databases: ApiDatabase[];
  openId: string | null;
  online: boolean;
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: (input: { name: string; icon?: string }) => Promise<ApiDatabase | null>;
  onRename: (database: ApiDatabase, name: string) => void;
  onDelete: (database: ApiDatabase) => void;
}

function DatabaseList({ databases, openId, online, loading, onOpen, onCreate, onRename, onDelete }: DatabaseListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="mb-5">
      <ContextSectionHeader label="Databases" />

      {databases.length === 0 && !loading && (
        <p className="px-3 pb-1 text-[12.5px] leading-relaxed text-a-faint">
          {online ? 'None yet.' : 'Unavailable while the server is unreachable.'}
        </p>
      )}

      <ul className="space-y-0.5">
        {databases.map((database) => {
          const active = database.id === openId;

          if (renamingId === database.id) {
            return (
              <li key={database.id} className={contextRowClass(true)}>
                <input
                  autoFocus
                  value={renameValue}
                  maxLength={100}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    const name = renameValue.trim();
                    if (name && name !== database.name) onRename(database, name);
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  aria-label={`Rename ${database.name}`}
                  className="min-w-0 flex-1 border-b border-a-accent bg-transparent text-[14.5px] font-semibold text-a-ink outline-none"
                />
              </li>
            );
          }

          return (
            <li key={database.id} className="group relative">
              <button
                type="button"
                onClick={() => onOpen(database.id)}
                aria-current={active ? 'true' : undefined}
                className={contextRowClass(active)}
              >
                <span className="w-4 flex-shrink-0 text-center" aria-hidden>{database.icon || '▦'}</span>
                <span className={cn('min-w-0 flex-1 truncate text-[14.5px]', active ? 'font-semibold text-a-ink' : 'text-a-muted')}>
                  {database.name}
                </span>
              </button>

              <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                <DropdownMenu onOpenChange={(isOpen) => { if (!isOpen) setConfirmId(null); }}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={contextIconButton} aria-label={`Options for ${database.name}`}>
                      <MoreHorizontal className="size-3.5" strokeWidth={2.75} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => { setRenamingId(database.id); setRenameValue(database.name); }}>
                      <Pencil className="size-3.5" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {confirmId === database.id ? (
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(database)}>
                        <Trash2 className="size-3.5" /> Delete it and its records
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={(e) => { e.preventDefault(); setConfirmId(database.id); }}
                      >
                        <Trash2 className="size-3.5" /> Delete database…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          );
        })}
      </ul>

      {online && <NewDatabaseButton onCreate={onCreate} onCreated={onOpen} />}
    </div>
  );
}

function NewDatabaseButton({
  onCreate, onCreated,
}: { onCreate: DatabaseListProps['onCreate']; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const created = await onCreate({ name: trimmed, icon: icon.trim() });
    setSaving(false);
    if (!created) return;
    onCreated(created.id);
    setName(''); setIcon(''); setOpen(false);
    toast.success(`Created "${created.name}"`, { duration: 2000 });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1.5 flex w-full items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-left text-[13.5px] text-a-faint transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
        >
          <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
          New database
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-3">
        <div className="space-y-2.5">
          <Input
            autoFocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="e.g. Reading list"
            aria-label="Database name"
            className="h-8 rounded-full text-[14px]"
          />
          <Input
            value={icon}
            maxLength={4}
            onChange={(e) => setIcon(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="Emoji (optional)"
            aria-label="Emoji"
            className="h-8 w-[130px] rounded-full text-[14px]"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || saving}
            className="h-8 w-full rounded-full bg-a-accent text-[13.5px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create database'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
