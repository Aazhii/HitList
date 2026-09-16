/**
 * The table layout: one row per task, one column per property — the task's own
 * title, status, quadrant and due date, then each custom field in field order.
 *
 * Every cell edits in place. Titles wrap and edit in a box that grows; numbers,
 * text and dates save on Enter or when the cell loses focus; status, quadrant,
 * select, multi-select and checkbox save as soon as they change.
 *
 * A column header sorts by that column (ascending, descending, then back to the
 * manual order) and carries a menu: hide the column, and for a field, edit or
 * delete the field itself — the only place in the app where a field can be
 * changed from where it is used. "+" at the end adds a field.
 *
 * Tasks from every quadrant share one list here, so rows are ordered with
 * compareAcrossQuadrants. With a group-by field set, rows are grouped under one
 * heading per option, and each group can add a task already carrying its value.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, ChevronDown, EyeOff, MoreHorizontal, PanelRightOpen, Pencil, Plus, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldValueEditor } from '@/components/fields/FieldValueEditor';
import { QUADRANTS, type Quadrant, type Todo, type TodoStatus } from '@/types/todo';
import type { TaskCompare } from '@/lib/quadrantBuckets';
import {
  FIELD_EMPTY, fieldSortKey, groupByField, type FilterState, type TaskGroup,
} from '@/lib/taskFilters';
import { OPTION_CHIP_CLASS, OPTION_DOT_CLASS, selectedOptions } from '@/lib/fieldValues';
import type { FieldDef, FieldValue, TaskFieldValues } from '@/types/fields';

type SortBy = FilterState['sortBy'];

/** Column ids: the task's own columns, then a field's id. Title is always shown. */
export const TASK_COLUMNS = ['title', 'status', 'quadrant', 'due'] as const;

export interface TaskTableViewProps {
  todos: Todo[];
  showDone: boolean;
  /** Row order; tasks from every quadrant are compared with one another. */
  compare: TaskCompare;
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  onSortChange: (sortBy: SortBy, sortDir: 'asc' | 'desc') => void;
  groupField: FieldDef | null;
  fieldDefs: FieldDef[];
  fieldValues: TaskFieldValues;
  /** Column ids not shown. Title cannot be hidden. */
  hiddenColumns?: string[];
  onHideColumn?: (columnId: string) => void;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onUpdate: (id: string, changes: Partial<Todo>) => void;
  onSetFieldValue: (taskId: string, fieldId: string, value: FieldValue | null) => void;
  onOpen: (todo: Todo) => void;
  onDelete?: (id: string) => void;
  /** Creates a task; the group key is '' when the table is not grouped. */
  onAddTask?: (title: string, groupKey: string) => void;
  onEditField?: (fieldId: string) => void;
  onDeleteField?: (fieldId: string) => void;
  onCreateField?: () => void;
}

const STATUS_OPTIONS: Array<{ value: TodoStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const CELL = 'px-2 py-1 align-top';
const CONTROL = cn(
  'w-full rounded-[9px] border-0 bg-transparent px-2 text-left text-[13.5px] text-a-ink',
  'transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]',
  'focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a-accent',
);
const CONTROL_ROW = cn(CONTROL, 'h-8');

/** "Sep 20", or "Sep 20, 2027" in another year — the same shape as a card's due chip. */
function formatDue(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function TaskTableView({
  todos, showDone, compare, sortBy, sortDir, onSortChange, groupField,
  fieldDefs, fieldValues, hiddenColumns = [], onHideColumn,
  onStatusChange, onUpdate, onSetFieldValue, onOpen, onDelete, onAddTask,
  onEditField, onDeleteField, onCreateField,
}: TaskTableViewProps) {
  const hidden = new Set(hiddenColumns.filter((id) => id !== 'title'));
  const shownFields = fieldDefs.filter((d) => !hidden.has(d.id));

  const groups: TaskGroup[] = useMemo(() => {
    if (groupField) return groupByField(todos, showDone, compare, groupField, fieldValues);
    const rows = todos.filter((t) => showDone || t.status !== 'done').sort(compare);
    return [{ key: '', label: '', color: null, tasks: rows }];
  }, [todos, showDone, compare, groupField, fieldValues]);

  const columnCount = 1 + TASK_COLUMNS.filter((c) => c !== 'title' && !hidden.has(c)).length + shownFields.length + 1;
  const rowCount = groups.reduce((n, g) => n + g.tasks.length, 0);

  const sortOf = (key: SortBy): 'asc' | 'desc' | null => (sortBy === key ? sortDir : null);
  const cycle = (key: SortBy): [SortBy, 'asc' | 'desc'] => {
    if (sortBy !== key) return [key, 'asc'];
    if (sortDir === 'asc') return [key, 'desc'];
    return ['order', 'asc'];
  };

  return (
    <div className="w-full overflow-x-auto animate-fade-in">
      <table className="w-full min-w-max border-collapse text-[13.5px]">
        <thead>
          <tr className="border-b border-a-line-soft">
            <ColumnHeader
              label="Title"
              sort={sortOf('title')}
              onSort={() => onSortChange(...cycle('title'))}
              className="sticky left-0 z-10 min-w-[280px] bg-a-bg"
            />
            {!hidden.has('status') && (
              <ColumnHeader label="Status" sort={sortOf('status')} onSort={() => onSortChange(...cycle('status'))} onHide={onHideColumn && (() => onHideColumn('status'))} />
            )}
            {!hidden.has('quadrant') && (
              <ColumnHeader label="Quadrant" sort={sortOf('quadrant')} onSort={() => onSortChange(...cycle('quadrant'))} onHide={onHideColumn && (() => onHideColumn('quadrant'))} />
            )}
            {!hidden.has('due') && (
              <ColumnHeader label="Due" sort={sortOf('due-date')} onSort={() => onSortChange(...cycle('due-date'))} onHide={onHideColumn && (() => onHideColumn('due'))} />
            )}
            {shownFields.map((def) => (
              <ColumnHeader
                key={def.id}
                label={def.name}
                sort={sortOf(fieldSortKey(def.id))}
                onSort={() => onSortChange(...cycle(fieldSortKey(def.id)))}
                onHide={onHideColumn && (() => onHideColumn(def.id))}
                onEditField={onEditField && (() => onEditField(def.id))}
                onDeleteField={onDeleteField && (() => onDeleteField(def.id))}
              />
            ))}
            <th scope="col" className="px-2 py-2 text-left align-bottom font-normal">
              {onCreateField && (
                <button
                  type="button"
                  onClick={onCreateField}
                  className="flex size-7 items-center justify-center rounded-[7px] text-a-faint transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
                  aria-label="Add a field"
                >
                  <Plus className="size-3.5" strokeWidth={2.75} />
                </button>
              )}
            </th>
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.key || 'all'}>
            {groupField && (
              <tr>
                <th colSpan={columnCount} scope="rowgroup" className="px-2 pt-5 pb-1.5 text-left font-normal">
                  <span className="sticky left-2 inline-flex items-center gap-2.5">
                    <span
                      className={cn('size-[9px] rounded-full', group.color ? OPTION_DOT_CLASS[group.color] : 'shadow-[inset_0_0_0_1.5px_var(--a-line)]')}
                      aria-hidden
                    />
                    <span className="font-display text-[16px] text-a-ink">{group.label}</span>
                    <span className="text-[12.5px] font-bold tabular-nums text-a-muted">{group.tasks.length}</span>
                  </span>
                </th>
              </tr>
            )}

            {group.tasks.map((todo) => (
              <TaskTableRow
                key={todo.id}
                todo={todo}
                fields={shownFields}
                hidden={hidden}
                values={fieldValues[todo.id]}
                onStatusChange={onStatusChange}
                onUpdate={onUpdate}
                onSetFieldValue={onSetFieldValue}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}

            {onAddTask && (
              <tr>
                <td colSpan={columnCount} className="px-2 py-0.5">
                  <NewTaskRow
                    label={groupField ? group.label : 'this list'}
                    onAdd={(title) => onAddTask(title, group.key)}
                  />
                </td>
              </tr>
            )}

            {group.tasks.length === 0 && groupField && group.key !== FIELD_EMPTY && !onAddTask && (
              <tr><td colSpan={columnCount} className="px-4 py-1.5 text-[13px] text-a-faint">No tasks</td></tr>
            )}
          </tbody>
        ))}
      </table>

      {rowCount === 0 && !groupField && (
        <p className="px-4 py-8 text-center text-[13.5px] text-a-faint">
          No open tasks. Turn on <span className="font-semibold">Show completed</span> to see finished ones.
        </p>
      )}
    </div>
  );
}

interface ColumnHeaderProps {
  label: string;
  sort: 'asc' | 'desc' | null;
  onSort: () => void;
  className?: string;
  onHide?: () => void;
  onEditField?: () => void;
  onDeleteField?: () => void;
}

/** A sortable header with a menu: hide the column, and edit or delete a field. */
function ColumnHeader({ label, sort, onSort, className, onHide, onEditField, onDeleteField }: ColumnHeaderProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasMenu = Boolean(onHide || onEditField || onDeleteField);

  return (
    <th
      scope="col"
      aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('group/head px-2 py-2 text-left align-bottom font-normal', className)}
    >
      <span className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'flex items-center gap-1 rounded-[7px] px-2 py-1 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150',
            sort ? 'text-a-ink' : 'text-a-faint hover:text-a-ink',
          )}
        >
          {label}
          {sort === 'asc' && <ArrowUp className="size-3" strokeWidth={2.75} aria-hidden />}
          {sort === 'desc' && <ArrowDown className="size-3" strokeWidth={2.75} aria-hidden />}
        </button>

        {hasMenu && (
          <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-[7px] text-a-faint opacity-0 transition-opacity duration-150 group-hover/head:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
                aria-label={`${label} column options`}
              >
                <ChevronDown className="size-3.5" strokeWidth={2.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {onEditField && (
                <DropdownMenuItem onClick={onEditField}>
                  <Pencil className="size-3.5" /> Edit field…
                </DropdownMenuItem>
              )}
              {onHide && (
                <DropdownMenuItem onClick={onHide}>
                  <EyeOff className="size-3.5" /> Hide column
                </DropdownMenuItem>
              )}
              {onDeleteField && (
                <>
                  <DropdownMenuSeparator />
                  {confirmDelete ? (
                    <DropdownMenuItem variant="destructive" onClick={onDeleteField}>
                      <Trash2 className="size-3.5" /> Delete from every task
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e) => { e.preventDefault(); setConfirmDelete(true); }}
                    >
                      <Trash2 className="size-3.5" /> Delete field…
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </th>
  );
}

interface TaskTableRowProps {
  todo: Todo;
  fields: FieldDef[];
  hidden: Set<string>;
  values: Record<string, FieldValue> | undefined;
  onStatusChange: TaskTableViewProps['onStatusChange'];
  onUpdate: TaskTableViewProps['onUpdate'];
  onSetFieldValue: TaskTableViewProps['onSetFieldValue'];
  onOpen: TaskTableViewProps['onOpen'];
  onDelete: TaskTableViewProps['onDelete'];
}

function TaskTableRow({ todo, fields, hidden, values, onStatusChange, onUpdate, onSetFieldValue, onOpen, onDelete }: TaskTableRowProps) {
  const isDone = todo.status === 'done';
  const quadrant = QUADRANTS.find((q) => q.id === todo.quadrant) ?? QUADRANTS[0];

  return (
    <tr className="group border-b border-a-line-soft/60">
      <td className={cn(CELL, 'sticky left-0 z-10 bg-a-bg')}>
        <div className="flex items-start gap-1">
          <TitleCell
            todo={todo}
            onCommit={(text) => { if (text && text !== todo.text) onUpdate(todo.id, { text }); }}
          />
          <button
            type="button"
            onClick={() => onOpen(todo)}
            className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-a-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:text-a-ink"
            aria-label={`Open ${todo.text}`}
          >
            <PanelRightOpen className="size-3.5" strokeWidth={2.5} />
          </button>
          <RowMenu todo={todo} onOpen={onOpen} onDelete={onDelete} />
        </div>
      </td>

      {!hidden.has('status') && (
        <td className={cn(CELL, 'min-w-[130px]')}>
          <Select value={todo.status} onValueChange={(v) => onStatusChange(todo.id, v as TodoStatus)}>
            <SelectTrigger size="sm" className={cn(CONTROL_ROW, 'shadow-none')} aria-label={`Status of ${todo.text}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </td>
      )}

      {!hidden.has('quadrant') && (
        <td className={cn(CELL, 'min-w-[140px]')}>
          <Select value={quadrant.id} onValueChange={(v) => onUpdate(todo.id, { quadrant: v as Quadrant })}>
            <SelectTrigger size="sm" className={cn(CONTROL_ROW, 'shadow-none')} aria-label={`Quadrant of ${todo.text}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUADRANTS.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  <span className="flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', q.dotClass)} aria-hidden />
                    {q.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
      )}

      {!hidden.has('due') && (
        <td className={cn(CELL, 'min-w-[130px]')}>
          <DueCell todo={todo} onChange={(dueDate) => onUpdate(todo.id, { dueDate })} />
        </td>
      )}

      {fields.map((def) => (
        <td key={def.id} className={cn(CELL, 'min-w-[150px]')}>
          <FieldCell
            def={def}
            value={values?.[def.id]}
            taskName={todo.text}
            onChange={(value) => onSetFieldValue(todo.id, def.id, value)}
          />
        </td>
      ))}

      <td className={CELL} aria-hidden />
    </tr>
  );
}

/** Wraps rather than cutting the title off, and edits in a box that grows. */
function TitleCell({ todo, onCommit }: { todo: Todo; onCommit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const isDone = todo.status === 'done';

  useEffect(() => { setDraft(todo.text); }, [todo.text]);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [editing, draft]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) { setDraft(todo.text); return; }
    onCommit(trimmed);
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        autoFocus
        value={draft}
        maxLength={200}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(todo.text); setEditing(false); }
        }}
        aria-label="Title"
        className={cn(CONTROL, 'min-w-0 flex-1 resize-none py-1.5 leading-snug')}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit title of ${todo.text}`}
      className={cn(CONTROL, 'min-w-0 flex-1 py-1.5 font-medium leading-snug', isDone && 'text-a-faint line-through')}
    >
      <span className="line-clamp-3 whitespace-pre-wrap">{todo.text}</span>
    </button>
  );
}

/** The due date as words, editing in a popover — not a raw browser date box. */
function DueCell({ todo, onChange }: { todo: Todo; onChange: (dueDate: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(CONTROL_ROW, 'flex items-center')} aria-label={`Due date of ${todo.text}`}>
          {todo.dueDate
            ? <span className="tabular-nums">{formatDue(todo.dueDate)}{todo.dueTime ? `, ${todo.dueTime}` : ''}</span>
            : <span className="text-a-faint/60">Empty</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={todo.dueDate ?? ''}
            onChange={(e) => { onChange(e.target.value); if (e.target.value) setOpen(false); }}
            aria-label="Due date"
            className="h-8 rounded-[9px] bg-transparent px-2 text-[13.5px] text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] outline-none"
          />
          {todo.dueDate && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="h-8 rounded-full px-3 text-[13px] text-a-muted transition-colors duration-150 hover:text-a-ink"
            >
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RowMenu({ todo, onOpen, onDelete }: Pick<TaskTableRowProps, 'todo' | 'onOpen' | 'onDelete'>) {
  const [confirm, setConfirm] = useState(false);
  if (!onDelete) return null;

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setConfirm(false); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-a-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
          aria-label={`Options for ${todo.text}`}
        >
          <MoreHorizontal className="size-3.5" strokeWidth={2.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={() => onOpen(todo)}>
          <PanelRightOpen className="size-3.5" /> Open
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {confirm ? (
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(todo.id)}>
            <Trash2 className="size-3.5" /> Delete for good
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={(e) => { e.preventDefault(); setConfirm(true); }}>
            <Trash2 className="size-3.5" /> Delete task…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The last row of a group: type a title, Enter adds it there. */
function NewTaskRow({ label, onAdd }: { label: string; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState('');

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onAdd(trimmed);
    setTitle('');
  };

  return (
    <div className="flex items-center gap-1.5 text-a-faint">
      <Plus className="size-3.5 flex-shrink-0" strokeWidth={2.75} aria-hidden />
      <input
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setTitle('');
        }}
        placeholder="New task"
        aria-label={`New task in ${label}`}
        className="h-8 w-full max-w-[320px] rounded-[9px] bg-transparent px-1 text-[13.5px] text-a-ink outline-none placeholder:text-a-faint/70 focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]"
      />
    </div>
  );
}

interface CellInputProps {
  value: string;
  type?: 'text' | 'number' | 'date';
  ariaLabel: string;
  className?: string;
  /** Called on Enter or blur with the draft; returns what the cell should show. */
  onCommit: (draft: string) => string;
}

/** A cell that looks like text and edits in place, saving on Enter or blur. Escape reverts. */
function CellInput({ value, type = 'text', ariaLabel, className, onCommit }: CellInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => { if (draft !== value) setDraft(onCommit(draft)); };

  return (
    <input
      type={type}
      value={draft}
      inputMode={type === 'number' ? 'decimal' : undefined}
      maxLength={type === 'text' ? 2000 : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
      placeholder="Empty"
      aria-label={ariaLabel}
      className={cn(CONTROL_ROW, 'placeholder:text-a-faint/60', className)}
    />
  );
}

interface FieldCellProps {
  def: FieldDef;
  value: FieldValue | undefined;
  taskName: string;
  onChange: (value: FieldValue | null) => void;
}

function FieldCell({ def, value, taskName, onChange }: FieldCellProps) {
  const label = `${def.name} of ${taskName}`;

  switch (def.kind) {
    case 'checkbox': {
      const on = value === true;
      return (
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-label={label}
          onClick={() => onChange(on ? null : true)}
          className={cn(CONTROL_ROW, 'flex items-center')}
        >
          <span
            className={cn(
              'flex size-[17px] items-center justify-center rounded-[6px] transition-colors duration-150',
              on ? 'bg-a-accent text-a-bg' : 'shadow-[inset_0_0_0_1.5px_var(--a-line)]',
            )}
            aria-hidden
          >
            {on && (
              <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6.5 4.75 8.75 9.5 3.5" />
              </svg>
            )}
          </span>
        </button>
      );
    }

    case 'text':
    case 'number':
    case 'date':
      return (
        <CellInput
          type={def.kind}
          value={value === undefined ? '' : String(value)}
          ariaLabel={label}
          onCommit={(draft) => {
            const raw = draft.trim();
            if (raw === '') { if (value !== undefined) onChange(null); return ''; }
            if (def.kind === 'number') {
              const n = Number(raw);
              if (!Number.isFinite(n)) return value === undefined ? '' : String(value);
              if (n !== value) onChange(n);
              return String(n);
            }
            if (raw !== value) onChange(def.kind === 'text' ? draft : raw);
            return def.kind === 'text' ? draft : raw;
          }}
        />
      );

    case 'select':
    case 'multi': {
      const chosen = selectedOptions(def, value);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn(CONTROL, 'flex min-h-8 flex-wrap items-center gap-1 py-1')} aria-label={label}>
              {chosen.length === 0 && <span className="text-a-faint/60">Empty</span>}
              {chosen.map((o) => (
                <span key={o.id} className={cn('rounded-full px-2 py-0.5 text-[12px] font-medium', OPTION_CHIP_CLASS[o.color])}>
                  {o.label}
                </span>
              ))}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <p className="mb-2 text-[12px] font-semibold text-a-muted">{def.name}</p>
            <FieldValueEditor field={def} value={value} onChange={onChange} />
          </PopoverContent>
        </Popover>
      );
    }
  }
}

