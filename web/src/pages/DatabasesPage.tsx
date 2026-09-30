/**
 * Databases: records that are not tasks.
 *
 * The left column lists the databases; the main area is the open one — see DatabaseWorkspace for what
 * is in it. Everything edits in place, as the tasks table does.
 *
 * What a database deliberately does not have: reminders, escalation and
 * automations. Those are built on tasks, and the page says so rather than
 * offering something that would quietly never fire.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
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
  ViewLayoutContext,
  contextIconButton,
  contextRowClass,
} from '@/components/shell/ViewLayout';
import { TopBar, topBarPrimary } from '@/components/shell/TopBar';
import { anchorRectOf } from '@/components/fields/FieldsManager';
import { DatabaseWorkspace } from '@/components/databases/DatabaseWorkspace';
import { EmptyState, ILL, type IllustrationName } from '@/components/EmptyState';
import { useDatabases } from '@/hooks/useDatabases';
import type { ApiDatabase } from '@/lib/api';
import type { TaskLinking } from '@/types/todo';

/**
 * What a database's text columns need to add a record's text to a quadrant
 * via the "@" menu — the same idea as notes' NoteTaskLinking, just keyed by
 * (recordId, fieldId) instead of (noteId, blockId).
 */
export type DatabaseTaskLinking = TaskLinking<{ recordId: string; fieldId: string }>;

export type { RecordValues } from '@/components/databases/DatabaseWorkspace';

export interface DatabasesPageProps {
  /** A database the calendar asked to open. */
  openDatabaseId?: string | null;
  onOpenHandled?: () => void;
  /** Reports which database is on screen, so Back/refresh can return to it. */
  onOpenChange?: (databaseId: string | null) => void;
  /** Tasks live in App, so it passes this down; without it the "@" menu is simply off. */
  linking?: DatabaseTaskLinking;
  /** The sidebar (rendered by App) now owns the databases list — this reports
   * it up on every change, instead of rendering its own context column. */
  onSidebarContentChange?: (context: ReactNode) => void;
  /** Opens the app-level sidebar's mobile sheet. */
  onOpenSidebar?: () => void;
  /** The nav row's count badge — how many databases exist. */
  onCountChange?: (count: number) => void;
  /** Make a new database as soon as this opens (the library's New page → Database). */
  createOnOpen?: boolean;
  onCreateHandled?: () => void;
}

export function DatabasesPage({ openDatabaseId, onOpenHandled, onOpenChange, linking, onSidebarContentChange, onOpenSidebar, onCountChange, createOnOpen, onCreateHandled }: DatabasesPageProps = {}) {
  const notify = useCallback((message: string) => toast.error(message, { duration: 3000 }), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const {
    databases, rows, online, loading, rowsLoading,
    createDatabase, updateDatabase, deleteDatabase, createRow, updateRow, deleteRow,
  } = useDatabases(openId, notify);
  const open = databases.find((d) => d.id === openId) ?? null;

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

  // The library's New page → Database: an "Untitled" one, opened.
  useEffect(() => {
    if (!createOnOpen || loading) return;
    onCreateHandled?.();
    void createDatabase({ name: 'Untitled', icon: '' }).then((created) => { if (created) setOpenId(created.id); });
  }, [createOnOpen, loading, createDatabase, onCreateHandled]);

  // The sidebar (rendered by App) now owns this list — report it up instead
  // of rendering our own context column.
  useEffect(() => {
    onSidebarContentChange?.(
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
      />,
    );
    return () => onSidebarContentChange?.(null);
     
  }, [databases, openId, online, loading]);

  useEffect(() => {
    onCountChange?.(databases.length);
     
  }, [databases.length]);

  const store = { rows, rowsLoading, createRow, updateRow, deleteRow, updateDatabase };
  const layout = { openContext: () => onOpenSidebar?.(), closeContext: () => {}, toggleCollapsed: () => {}, collapsible: false, collapsed: false };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ViewLayoutContext.Provider value={layout}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {open && online ? (
            <DatabaseWorkspace
              key={open.id}
              database={open}
              store={store}
              linking={linking}
              header={({ rowCount, fieldCount, openNewColumn }) => (
                <TopBar
                  title={`${open.icon ? `${open.icon} ` : ''}${open.name}`}
                  subtitle={`${rowCount} record${rowCount === 1 ? '' : 's'} · ${fieldCount} column${fieldCount === 1 ? '' : 's'}`}
                  actions={(
                    <button
                      type="button"
                      onClick={(e) => openNewColumn(anchorRectOf(e.currentTarget))}
                      className={topBarPrimary}
                      aria-label="New column"
                    >
                      <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
                      <span className="hidden sm:inline">New column</span>
                    </button>
                  )}
                />
              )}
            />
          ) : (
            <>
              <TopBar title="Databases" subtitle="Records that are not tasks" />
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <div className="px-4 pt-4 pb-12 md:px-12">
                  {!online && !loading ? (
                    <EmptyNote
                      image={ILL.errorState}
                      title="Databases need the server"
                      body="A record's columns are field definitions the server holds, so there is no offline copy. Try again when it is reachable."
                    />
                  ) : loading ? null : databases.length === 0 ? (
                    <EmptyNote
                      image={ILL.sampleData}
                      title="No databases yet"
                      body="A database keeps records that are not tasks — a reading list, clients, anything with its own columns. Make one from the list on the left."
                    />
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </ViewLayoutContext.Provider>
    </div>
  );
}

function EmptyNote({ title, body, image }: { title: string; body: string; image: IllustrationName }) {
  return <EmptyState image={image} title={title} description={body} />;
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
      <ContextSectionHeader label="Databases" action={online ? <NewDatabaseButton onCreate={onCreate} onCreated={onOpen} /> : undefined} />

      {databases.length === 0 && !loading && (
        <p className="px-3 pb-1 text-[12px] leading-relaxed text-a-faint">
          {online ? 'None yet.' : 'Unavailable while the server is unreachable.'}
        </p>
      )}

      <ul>
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
                  className="min-w-0 flex-1 border-b border-a-accent bg-transparent text-[14px] font-semibold text-a-ink outline-none"
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
                <span className={cn('min-w-0 flex-1 truncate text-[14px]', active ? 'font-semibold text-a-ink' : 'text-a-muted')}>
                  {database.name}
                </span>
              </button>

              <div className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                <DropdownMenu onOpenChange={(isOpen) => { if (!isOpen) setConfirmId(null); }}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={contextIconButton} aria-label={`Options for ${database.name}`}>
                      <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
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

  // Showcase 1124–1131: the "+" beside the Databases label opens a 280px panel at the sidebar's
  // edge — a name, an optional emoji, and Create database.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={contextIconButton} aria-label="New database" title="New database">
          <Plus className="size-3.5" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label="New database"
        side="right"
        align="start"
        sideOffset={3}
        alignOffset={-7}
        className="w-[280px] gap-3 rounded-[12px] p-3.5 shadow-[var(--a-shadow-xl)]"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="new-db-name" className="text-[13px] font-medium leading-[1.35] text-a-ink">Database name</label>
          <Input
            id="new-db-name"
            autoFocus
            className="h-7 px-2"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="e.g. Reading list"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="new-db-emoji" className="text-[13px] font-medium leading-[1.35] text-a-ink">Emoji (optional)</label>
          <Input
            id="new-db-emoji"
            className="h-7 px-2"
            value={icon}
            maxLength={4}
            onChange={(e) => setIcon(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          aria-disabled={!name.trim() || saving}
          className={cn(topBarPrimary, 'w-full justify-center')}
        >
          {saving ? 'Creating…' : 'Create database'}
        </button>
      </PopoverContent>
    </Popover>
  );
}
