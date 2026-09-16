/**
 * The tabs above the tasks in Table, Board and Calendar.
 *
 * Three built-in tabs — Table, Board, Calendar — then one tab per saved view of
 * those layouts, then "+ New". That is how a named board is made: New asks for a
 * name, a layout, and for a board the field its columns come from, and saves a
 * view. Before this, a board existed only as "Save as view" at the foot of the
 * filter popover, and the Views list stayed empty.
 *
 * A saved tab that no longer matches the screen — a filter changed, another field
 * grouped — shows a dot with Save and Reset, so it is clear the tab is no longer
 * showing what it was saved as.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Copy } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ApiSavedView, TaskLayout } from '@/lib/api';
import type { FieldDef } from '@/types/fields';

/** The layouts that live in these tabs. List and Matrix stay in the top bar. */
export const TAB_LAYOUTS: ReadonlyArray<{ value: TaskLayout; label: string }> = [
  { value: 'table', label: 'Table' },
  { value: 'board', label: 'Board' },
];

export interface NewViewInput {
  name: string;
  layout: TaskLayout;
  /** The field a board's columns come from; '' for table and calendar. */
  groupBy: string;
  scopeToList: boolean;
}

export interface ViewTabsProps {
  layout: TaskLayout;
  views: ApiSavedView[];
  /** The view being shown, or null for a built-in tab. */
  appliedViewId: string | null;
  /** True when the screen no longer matches the applied view. */
  dirty: boolean;
  listId: string;
  listName: string;
  online: boolean;
  /** Fields a board can make columns from. */
  groupFields: FieldDef[];
  onSelectLayout: (layout: TaskLayout) => void;
  onApplyView: (view: ApiSavedView) => void;
  onCreate: (input: NewViewInput) => Promise<boolean>;
  onRename: (view: ApiSavedView, name: string) => void;
  onDuplicate: (view: ApiSavedView) => void;
  onDelete: (view: ApiSavedView) => void;
  onSaveChanges: (view: ApiSavedView) => void;
  onResetChanges: (view: ApiSavedView) => void;
  onManageFields: () => void;
  /** Sits at the end of the row — the table's Columns button. */
  trailing?: React.ReactNode;
}

const TAB = cn(
  'flex h-7 flex-shrink-0 items-center gap-1.5 rounded-full px-3 text-[13.5px] whitespace-nowrap transition-colors duration-150 sm:px-3.5',
);
const TAB_ACTIVE = 'bg-a-bg font-semibold text-a-ink shadow-[0_1px_2px_rgba(46,43,37,0.14)]';
const TAB_IDLE = 'text-a-muted hover:text-a-ink';

export function ViewTabs({
  layout, views, appliedViewId, dirty, listId, listName, online, groupFields,
  onSelectLayout, onApplyView, onCreate, onRename, onDuplicate, onDelete,
  onSaveChanges, onResetChanges, onManageFields, trailing,
}: ViewTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  // Only views of these layouts, and only those that open here or anywhere.
  const tabViews = views.filter(
    (v) => TAB_LAYOUTS.some((l) => l.value === v.layout) && (!v.scopeListId || v.scopeListId === listId),
  );
  const applied = appliedViewId ? views.find((v) => v.id === appliedViewId) ?? null : null;

  const commitRename = (view: ApiSavedView) => {
    const name = renameValue.trim();
    if (name && name !== view.name) onRename(view, name);
    setRenamingId(null);
  };

  return (
    <div className="mb-4 flex items-center gap-2">
      <div
        role="tablist"
        aria-label="Task views"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-full bg-[color-mix(in_srgb,var(--a-ink)_7%,transparent)] p-[3px]"
      >
        {TAB_LAYOUTS.map((l) => {
          const active = !appliedViewId && layout === l.value;
          return (
            <button
              key={l.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectLayout(l.value)}
              className={cn(TAB, active ? TAB_ACTIVE : TAB_IDLE)}
            >
              {l.label}
            </button>
          );
        })}

        {tabViews.map((view) => {
          const active = view.id === appliedViewId;

          if (renamingId === view.id) {
            return (
              <input
                key={view.id}
                ref={renameRef}
                value={renameValue}
                maxLength={100}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => commitRename(view)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(view);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                aria-label={`Rename ${view.name}`}
                className={cn(TAB, TAB_ACTIVE, 'w-[130px] border-b border-a-accent bg-a-bg outline-none')}
              />
            );
          }

          return (
            <span key={view.id} className={cn(TAB, 'gap-1 pr-1', active ? TAB_ACTIVE : TAB_IDLE)}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onApplyView(view)}
                className="max-w-[160px] truncate"
              >
                {view.name}
              </button>
              {active && dirty && <span className="size-1.5 rounded-full bg-a-accent" aria-label="Changed" />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded-full text-a-faint hover:text-a-ink"
                    aria-label={`Options for ${view.name}`}
                  >
                    <MoreHorizontal className="size-3.5" strokeWidth={2.75} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem onClick={() => { setRenamingId(view.id); setRenameValue(view.name); }}>
                    <Pencil className="size-3.5" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDuplicate(view)}>
                    <Copy className="size-3.5" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(view)}>
                    <Trash2 className="size-3.5" /> Delete view
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          );
        })}

        <NewViewButton
          layout={layout}
          listName={listName}
          groupFields={groupFields}
          online={online}
          onCreate={onCreate}
          onManageFields={onManageFields}
        />
      </div>

      {trailing}

      {applied && dirty && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onSaveChanges(applied)}
            className="flex h-7 items-center gap-1.5 rounded-full bg-a-accent px-3 text-[13px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600"
          >
            <Check className="size-3.5" strokeWidth={2.75} aria-hidden />
            Save
          </button>
          <button
            type="button"
            onClick={() => onResetChanges(applied)}
            className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-a-muted transition-colors duration-150 hover:text-a-ink"
          >
            <RotateCcw className="size-3.5" strokeWidth={2.5} aria-hidden />
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

interface NewViewButtonProps {
  layout: TaskLayout;
  listName: string;
  groupFields: FieldDef[];
  online: boolean;
  onCreate: (input: NewViewInput) => Promise<boolean>;
  onManageFields: () => void;
}

function NewViewButton({ layout, listName, groupFields, online, onCreate, onManageFields }: NewViewButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [newLayout, setNewLayout] = useState<TaskLayout>(layout);
  const [groupBy, setGroupBy] = useState(groupFields[0]?.id ?? '');
  const [scoped, setScoped] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setNewLayout(layout);
    setGroupBy(groupFields[0]?.id ?? '');
  }, [open, layout, groupFields]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const ok = await onCreate({
      name: trimmed,
      layout: newLayout,
      groupBy: newLayout === 'board' ? groupBy : '',
      scopeToList: scoped,
    });
    setSaving(false);
    if (ok) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(TAB, TAB_IDLE, 'gap-1 px-2.5')}
          aria-label="New view"
          disabled={!online}
          title={online ? undefined : 'Saved views need the server'}
        >
          <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
          New
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-3">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint" htmlFor="new-view-name">Name</label>
            <Input
              id="new-view-name"
              autoFocus
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              placeholder="e.g. Stages"
              className="h-8 rounded-full text-[14px]"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint">Layout</span>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Layout">
              {TAB_LAYOUTS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  role="radio"
                  aria-checked={newLayout === l.value}
                  onClick={() => setNewLayout(l.value)}
                  className={cn(
                    'h-7 flex-1 rounded-full text-[13px] transition-colors duration-150',
                    newLayout === l.value
                      ? 'bg-a-accent font-semibold text-a-bg'
                      : 'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)] hover:text-a-ink',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {newLayout === 'board' && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint">Columns from</span>
              {groupFields.length === 0 ? (
                <button
                  type="button"
                  onClick={() => { setOpen(false); onManageFields(); }}
                  className="text-[13px] font-semibold text-a-accent-700 hover:text-a-accent"
                >
                  Create a field first
                </button>
              ) : (
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger size="sm" className="h-8 w-full rounded-xl text-xs" aria-label="Columns from">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groupFields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-a-ink">
            <input
              type="checkbox"
              checked={scoped}
              onChange={(e) => setScoped(e.target.checked)}
              className="size-3.5 accent-[var(--a-accent)]"
            />
            Only in <span className="font-semibold">{listName}</span>
          </label>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || saving || (newLayout === 'board' && groupFields.length === 0)}
            className="h-8 w-full rounded-full bg-a-accent text-[13.5px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create view'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
