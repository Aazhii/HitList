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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Calendar, CheckSquare, ChevronDown, CircleDot, EyeOff, Hash, List, MoreHorizontal,
  PanelRightOpen, Pencil, Plus, Trash2, Type, type LucideIcon,
} from 'lucide-react';
import { useTableKeyboard } from '@/hooks/useTaskKeyboard';
import { BulkBar, type BulkChange } from '@/components/tasks/BulkBar';
import { Checkbox } from '@/components/ui/checkbox';
import { selectAllState, toggleId, visibleSelection } from '@/lib/bulkSelection';
import { isTypingTarget } from '@/lib/taskKeyboard';
import { dueFill, fieldFill, fillRatio } from '@/lib/taskQuality';
import { cn } from '@/lib/utils';
import { topBarPill } from '@/components/shell/TopBar';
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
import { OPTION_CHIP_CLASS, NO_VALUE_DOT_CLASS, OPTION_DOT_CLASS, selectedOptions } from '@/lib/fieldValues';
import { FIELD_KIND_LABELS, type FieldDef, type FieldKind, type FieldValue, type TaskFieldValues } from '@/types/fields';

type SortBy = FilterState['sortBy'];

/** Column ids: the task's own columns, then a field's id. Title is always shown. */
export const TASK_COLUMNS = ['title', 'status', 'quadrant', 'due'] as const;

/**
 * Columns in a saved order: those the order names first, in that order, then
 * anything it does not mention in its natural place. Shared with the Columns
 * menu, so the list someone reorders is the list the table renders.
 */
export function sortByColumnOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return items
    .map((item, natural) => ({ item, natural }))
    .sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.natural - b.natural)
    .map(({ item }) => item);
}

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
  /** Column ids in the order to show them; anything missing keeps its natural place. */
  columnOrder?: string[];
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
  /** Set a status, quadrant or due date on every selected task at once. Without it the table has no selection. */
  onBulkChange?: (ids: string[], change: BulkChange) => void;
  onBulkDelete?: (ids: string[]) => void;
}

const STATUS_OPTIONS: Array<{ value: TodoStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

// DS Table (Table.jsx): 13px cells, 8px 12px padding (here 4px cell + 8px control), a
// hairline under each row. Controls look like plain text until hovered or focused.
/** The keyboard cursor's cell: a 2px inset ring in the brand colour. */
const CURSOR = 'data-[active]:shadow-[inset_0_0_0_2px_var(--a-accent)]';

const CELL = 'border-b border-a-line-soft px-1 py-[calc(2px+var(--a-density))] align-middle group-hover:bg-a-row-alt';
const CONTROL = cn(
  'w-full rounded-[4px] border-0 bg-transparent px-2 text-left text-[13px] text-a-ink',
  'transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]',
  'focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a-accent',
);
// The prototype's Status and Quadrant cells read as plain 13px text; the select only shows itself on hover.
const CONTROL_ROW = cn(CONTROL, 'h-8 data-[size=sm]:text-[13px] [&_svg]:opacity-0 hover:[&_svg]:opacity-100 focus-visible:[&_svg]:opacity-100');

/** "Sep 20", or "Sep 20, 2027" in another year — the same shape as a card's due chip. */
function formatDue(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * The table's due wording (showcase 250–261): "Overdue · Sep 27", "Today, 4:00 PM",
 * "Tomorrow", "Oct 2". Whole days, so a due-today task is never "overdue".
 */
export function tableDueLabel(dueDate: string, dueTime: string | undefined, now = new Date()): { label: string; overdue: boolean } {
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const time = dueTime
    ? `, ${new Date(`1970-01-01T${dueTime}:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : '';
  if (dueDate < key(now)) return { label: `Overdue · ${formatDue(dueDate)}`, overdue: true };
  if (dueDate === key(now)) return { label: `Today${time}`, overdue: false };
  if (dueDate === key(tomorrow)) return { label: `Tomorrow${time}`, overdue: false };
  return { label: `${formatDue(dueDate)}${time}`, overdue: false };
}

const KIND_GLYPH: Record<FieldKind, LucideIcon> = {
  text: Type, longtext: Type, number: Hash, date: Calendar, select: CircleDot, multi: List, checkbox: CheckSquare,
};

export function TaskTableView({
  todos, showDone, compare, sortBy, sortDir, onSortChange, groupField,
  fieldDefs, fieldValues, hiddenColumns = [], columnOrder = [], onHideColumn,
  onStatusChange, onUpdate, onSetFieldValue, onOpen, onDelete, onAddTask,
  onEditField, onDeleteField, onCreateField, onBulkChange, onBulkDelete,
}: TaskTableViewProps) {
  const hidden = new Set(hiddenColumns.filter((id) => id !== 'title'));
  const shownFields = fieldDefs.filter((d) => !hidden.has(d.id));

  /**
   * The columns to render, in order. Title is pinned first — it is the sticky
   * column every row is read from — and anything the saved order does not
   * mention keeps its natural place after what it does.
   */
  const columns = useMemo(() => {
    const all: TableColumn[] = [
      { id: 'status', label: 'Status', sortKey: 'status', glyph: CircleDot, typeLabel: 'status' },
      { id: 'quadrant', label: 'Quadrant', sortKey: 'quadrant', glyph: CircleDot, typeLabel: 'select' },
      { id: 'due', label: 'Due', sortKey: 'due-date', glyph: Calendar, typeLabel: 'date' },
      ...shownFields.map((field) => ({
        id: field.id, label: field.name, sortKey: fieldSortKey(field.id), field,
        glyph: KIND_GLYPH[field.kind], typeLabel: FIELD_KIND_LABELS[field.kind].toLowerCase(),
      })),
    ];

    return sortByColumnOrder(all.filter((c) => !hidden.has(c.id)), columnOrder);
  }, [shownFields, hidden, columnOrder]);

  const groups: TaskGroup[] = useMemo(() => {
    if (groupField) return groupByField(todos, showDone, compare, groupField, fieldValues);
    const rows = todos.filter((t) => showDone || t.status !== 'done').sort(compare);
    return [{ key: '', label: '', color: null, tasks: rows }];
  }, [todos, showDone, compare, groupField, fieldValues]);

  // The fill bar under a column that can be empty: Due, and each custom field. Status and Quadrant always have a value.
  const openTodos = useMemo(() => todos.filter((t) => showDone || t.status !== 'done'), [todos, showDone]);
  const fillOf = (column: TableColumn) => {
    const f = column.field ? fieldFill(column.field, openTodos, fieldValues) : column.id === 'due' ? dueFill(openTodos) : null;
    return f ? { ratio: fillRatio(f), filled: f.filled, total: f.total } : undefined;
  };

  // P5.4: j/k or the arrows move a cursor over the rows, h/l or the arrows across the cells; Enter edits the
  // cell, o opens the task, x toggles done, [ and ] move it a quadrant.
  const rowIds = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups]);
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.tasks).map((t) => [t.id, t])), [groups]);
  const lookup = useMemo(() => ({ statusOf: (id: string) => byId.get(id)?.status, quadrantOf: (id: string) => byId.get(id)?.quadrant }), [byId]);
  const keyHandlers = useMemo(() => ({
    onEdit: (id: string, col: number) => {
      const cell = document.querySelector<HTMLElement>(`[data-cell="${CSS.escape(id)}:${col}"]`);
      cell?.querySelector<HTMLElement>('button, input, [role="combobox"], [role="checkbox"]')?.click();
    },
    onOpen: (id: string) => { const t = byId.get(id); if (t) onOpen(t); },
    onStatus: onStatusChange,
    onQuadrant: (id: string, quadrant: Quadrant) => onUpdate(id, { quadrant }),
  }), [byId, onOpen, onStatusChange, onUpdate]);
  // P6.3: rows are selected from the checkbox that replaces the row number on hover, or with Space.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const selectedIds = useMemo(() => visibleSelection(selection, rowIds), [selection, rowIds]);
  const selectable = !!onBulkChange;
  const toggleRow = useCallback((id: string) => setSelection((s) => toggleId(s, id)), []);
  const clearSelection = useCallback(() => setSelection(new Set()), []);
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !isTypingTarget(document.activeElement)) clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedIds.length, clearSelection]);
  const keyHandlersWithSelect = useMemo(
    () => ({ ...keyHandlers, onSelect: selectable ? toggleRow : undefined }),
    [keyHandlers, selectable, toggleRow],
  );
  const kb = useTableKeyboard(rowIds, columns.length + 1, lookup, keyHandlersWithSelect);
  useEffect(() => {
    if (kb.activeId) document.querySelector(`[data-row="${CSS.escape(kb.activeId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [kb.activeId]);

  const columnCount = columns.length + 3;
  const rowCount = groups.reduce((n, g) => n + g.tasks.length, 0);
  let rowNumber = 0;

  const sortOf = (key: SortBy): 'asc' | 'desc' | null => (sortBy === key ? sortDir : null);
  const cycle = (key: SortBy): [SortBy, 'asc' | 'desc'] => {
    if (sortBy !== key) return [key, 'asc'];
    if (sortDir === 'asc') return [key, 'desc'];
    return ['order', 'asc'];
  };

  const allState = selectAllState(selectedIds.length, rowIds.length);

  return (
    <div className="animate-fade-in">
    {selectable && selectedIds.length > 0 && (
      <BulkBar
        count={selectedIds.length}
        onChange={(change) => onBulkChange(selectedIds, change)}
        onDelete={() => { if (onBulkDelete) onBulkDelete(selectedIds); clearSelection(); }}
        onClear={clearSelection}
      />
    )}
    <div className="max-h-[calc(100vh-260px)] w-full overflow-auto rounded-[6px] border border-a-line bg-a-surface">
      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]" style={{ minWidth: 368 + columns.length * 150 }}>
        <colgroup>
          <col style={{ width: 44 }} />
          <col style={{ width: '40%' }} />
          {columns.map((column) => <col key={column.id} />)}
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sticky top-0 left-0 z-[3] w-11 border-b border-a-line bg-a-line-soft px-3 py-2 text-right align-bottom text-[11px] font-bold text-a-faint">
              {selectable && selectedIds.length > 0 ? (
                <Checkbox
                  label={null}
                  aria-label={allState === 'all' ? 'Clear selection' : 'Select all tasks'}
                  checked={allState === 'all'}
                  onChange={() => setSelection(allState === 'all' ? new Set() : new Set(rowIds))}
                  className="justify-end"
                />
              ) : '#'}
            </th>
            <ColumnHeader
              label="Title"
              glyph={Type}
              typeLabel="text"
              sort={sortOf('title')}
              onSort={() => onSortChange(...cycle('title'))}
              className="left-11 z-[3] min-w-[280px]"
            />
            {columns.map((column) => (
              <ColumnHeader
                key={column.id}
                label={column.label}
                glyph={column.glyph}
                typeLabel={column.typeLabel}
                sort={sortOf(column.sortKey)}
                onSort={() => onSortChange(...cycle(column.sortKey))}
                fill={fillOf(column)}
                onHide={onHideColumn && (() => onHideColumn(column.id))}
                onEditField={column.field && onEditField ? () => onEditField(column.id) : undefined}
                onDeleteField={column.field && onDeleteField ? () => onDeleteField(column.id) : undefined}
              />
            ))}
            <th scope="col" className="sticky top-0 z-[2] w-11 border-b border-a-line bg-a-bg px-2 py-2 text-left align-bottom font-normal">
              {onCreateField && (
                <button
                  type="button"
                  onClick={onCreateField}
                  className="flex size-7 items-center justify-center rounded-[6px] text-a-faint transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
                  aria-label="Add a field"
                >
                  <Plus className="size-3.5" strokeWidth={1.75} />
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
                      className={cn('size-[9px] rounded-full', group.color ? OPTION_DOT_CLASS[group.color] : NO_VALUE_DOT_CLASS)}
                      aria-hidden
                    />
                    <span className="font-display text-[16px] text-a-ink">{group.label}</span>
                    <span className="text-[12px] font-bold tabular-nums text-a-muted">{group.tasks.length}</span>
                  </span>
                </th>
              </tr>
            )}

            {group.tasks.map((todo) => (
              <TaskTableRow
                key={todo.id}
                rowNumber={++rowNumber}
                todo={todo}
                columns={columns}
                activeCol={kb.activeId === todo.id ? kb.activeCol : null}
                selected={selection.has(todo.id)}
                selecting={selectedIds.length > 0}
                onToggleSelected={selectable ? toggleRow : undefined}
                values={fieldValues[todo.id]}
                onStatusChange={onStatusChange}
                onUpdate={onUpdate}
                onSetFieldValue={onSetFieldValue}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}

            {onAddTask && groupField && (
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
    </div>

      {onAddTask && !groupField && (
        <div className="mt-2">
          <NewTaskRow label="this list" onAdd={(title) => onAddTask(title, '')} />
        </div>
      )}

      {rowCount === 0 && !groupField && (
        <p className="px-4 py-8 text-center text-[14px] text-a-faint">
          No open tasks. Turn on <span className="font-semibold">Show completed</span> to see finished ones.
        </p>
      )}
    </div>
  );
}

interface ColumnHeaderProps {
  label: string;
  glyph: LucideIcon;
  typeLabel: string;
  sort: 'asc' | 'desc' | null;
  onSort: () => void;
  className?: string;
  /** 0–1: how many tasks have a value here; a bar under the header says so (P5.3). Omitted: not measured. */
  fill?: { ratio: number; filled: number; total: number };
  onHide?: () => void;
  onEditField?: () => void;
  onDeleteField?: () => void;
}

/** A sortable header with a menu: hide the column, and edit or delete a field. */
function ColumnHeader({ label, glyph: Glyph, typeLabel, sort, onSort, className, fill, onHide, onEditField, onDeleteField }: ColumnHeaderProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasMenu = Boolean(onHide || onEditField || onDeleteField);

  return (
    <th
      scope="col"
      aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('group/head sticky top-0 z-[2] border-b border-a-line bg-a-bg p-0 text-left align-bottom font-normal', className)}
    >
      <div className="flex min-w-[120px] flex-col gap-1.5 px-3 py-2">
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSort}
          className="flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap text-a-ink"
        >
          <Glyph className="size-3.5 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
          {label}
          {sort === 'asc' && <ArrowUp className="size-3" strokeWidth={1.75} aria-hidden />}
          {sort === 'desc' && <ArrowDown className="size-3" strokeWidth={1.75} aria-hidden />}
        </button>

        {hasMenu && (
          <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="-my-0.5 flex size-5 items-center justify-center rounded-[4px] text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover/head:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
                aria-label={`${label} column options`}
              >
                <ChevronDown className="size-3.5" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-52"
              // "Edit field…" opens another popover (FieldsManagerDialog);
              // see RecordTable's FieldHeader for why this prevents it closing itself.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
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
      <span className="text-[11px] font-normal text-a-faint">{typeLabel}</span>
      </div>
      {fill && (
        // DataPrep's fill bar: the share of tasks with a value in this column.
        <span
          role="img"
          aria-label={`${fill.filled} of ${fill.total} have a value`}
          title={`${fill.filled} of ${fill.total} have a value`}
          className="absolute inset-x-0 bottom-0 h-[3px] bg-a-dq-missing"
        >
          <span className="block h-full bg-a-dq-valid" style={{ width: `${Math.round(fill.ratio * 100)}%` }} />
        </span>
      )}
    </th>
  );
}

export interface TableColumn {
  id: string;
  label: string;
  sortKey: SortBy;
  glyph: LucideIcon;
  /** The DS column head's second line: the column's type, lower-case. */
  typeLabel: string;
  /** Set for a custom field column. */
  field?: FieldDef;
}

interface TaskTableRowProps {
  rowNumber: number;
  todo: Todo;
  columns: TableColumn[];
  /** The cell the keyboard cursor is on in this row (0 is the title), or null when the cursor is elsewhere. */
  activeCol: number | null;
  /** Part of the selection; `selecting` is true while any row is, which keeps every row's checkbox showing. */
  selected: boolean;
  selecting: boolean;
  onToggleSelected?: (id: string) => void;
  values: Record<string, FieldValue> | undefined;
  onStatusChange: TaskTableViewProps['onStatusChange'];
  onUpdate: TaskTableViewProps['onUpdate'];
  onSetFieldValue: TaskTableViewProps['onSetFieldValue'];
  onOpen: TaskTableViewProps['onOpen'];
  onDelete: TaskTableViewProps['onDelete'];
}

function TaskTableRow({ rowNumber, todo, columns, activeCol, selected, selecting, onToggleSelected, values, onStatusChange, onUpdate, onSetFieldValue, onOpen, onDelete }: TaskTableRowProps) {
  const isDone = todo.status === 'done';
  const quadrant = QUADRANTS.find((q) => q.id === todo.quadrant) ?? QUADRANTS[0];

  // Each cell is findable by the keyboard layer, and the one under its cursor is ringed.
  // A click anywhere in a cell, not only on its small control, opens that control (a select, a date, a menu).
  const cell = (i: number) => ({
    'data-cell': `${todo.id}:${i}`,
    'data-active': activeCol === i ? '' : undefined,
    onClick: (e: React.MouseEvent<HTMLTableCellElement>) => {
      if (e.target !== e.currentTarget) return;
      e.currentTarget.querySelector<HTMLElement>('[role="combobox"], button, input')?.click();
    },
  });

  return (
    <tr className="group" data-row={todo.id}>
      <td className={cn(
        'sticky left-0 z-[1] w-11 border-b border-a-line-soft px-3 text-right text-[13px] tabular-nums text-a-ink',
        selected ? 'bg-a-blue-tint' : 'bg-a-row-alt',
      )}>
        {onToggleSelected ? (
          <>
            <span className={cn(selecting || selected ? 'hidden' : 'group-hover:hidden')}>{rowNumber}</span>
            <Checkbox
              label={null}
              aria-label={`Select ${todo.text}`}
              checked={selected}
              onChange={() => onToggleSelected(todo.id)}
              className={cn('justify-end', selecting || selected ? 'flex' : 'hidden group-hover:flex focus-within:flex')}
            />
          </>
        ) : rowNumber}
      </td>
      <td {...cell(0)} className={cn(CELL, 'sticky left-11 z-[1] bg-a-surface', CURSOR)}>
        <div className="flex min-w-0 items-start gap-1">
          <TitleCell
            todo={todo}
            onCommit={(text) => { if (text && text !== todo.text) onUpdate(todo.id, { text }); }}
          />
          <button
            type="button"
            onClick={() => onOpen(todo)}
            className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-visible:opacity-100 hover:text-a-ink"
            aria-label={`Open ${todo.text}`}
          >
            <PanelRightOpen className="size-3.5" strokeWidth={1.75} />
          </button>
          <RowMenu todo={todo} onOpen={onOpen} onDelete={onDelete} />
        </div>
      </td>

      {columns.map((column, ci) => {
        if (column.field) {
          return (
            <td key={column.id} {...cell(ci + 1)} className={cn(CELL, 'min-w-[150px]', CURSOR)}>
              <FieldCell
                def={column.field}
                value={values?.[column.id]}
                taskName={todo.text}
                onChange={(value) => onSetFieldValue(todo.id, column.id, value)}
              />
            </td>
          );
        }

        if (column.id === 'status') {
          return (
            <td key={column.id} {...cell(ci + 1)} className={cn(CELL, 'min-w-[130px]', CURSOR)}>
              <Select value={todo.status} onValueChange={(v) => onStatusChange(todo.id, v as TodoStatus)}>
                <SelectTrigger size="sm" className={cn(CONTROL_ROW, 'shadow-none')} aria-label={`Status of ${todo.text}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </td>
          );
        }

        if (column.id === 'quadrant') {
          return (
            <td key={column.id} {...cell(ci + 1)} className={cn(CELL, 'min-w-[140px]', CURSOR)}>
              <Select value={quadrant.id} onValueChange={(v) => onUpdate(todo.id, { quadrant: v as Quadrant })}>
                <SelectTrigger size="sm" className={cn(CONTROL_ROW, 'shadow-none')} aria-label={`Quadrant of ${todo.text}`}>
                  <SelectValue>{quadrant.label}</SelectValue>
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
          );
        }

        return (
          <td
            key={column.id}
            {...cell(ci + 1)}
            className={cn(
              CELL, 'min-w-[130px]', CURSOR,
              !isDone && todo.dueDate && tableDueLabel(todo.dueDate, todo.dueTime).overdue
                && 'bg-a-red-tint text-a-red-ink shadow-[inset_2px_0_0_var(--a-red-line)]',
            )}
          >
            <DueCell todo={todo} onChange={(dueDate) => onUpdate(todo.id, { dueDate })} />
          </td>
        );
      })}

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
        className={cn(CONTROL, 'min-w-0 flex-1 resize-none py-1.5 leading-snug [overflow-wrap:anywhere]')}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit title of ${todo.text}`}
      className={cn(CONTROL, 'min-w-0 flex-1 py-1.5 leading-snug', isDone && 'text-a-faint line-through')}
    >
      <span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">{todo.text}</span>
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
            ? <span className="tabular-nums">{tableDueLabel(todo.dueDate, todo.dueTime).label}</span>
            : <span className="italic text-a-faint">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={todo.dueDate ?? ''}
            onChange={(e) => { onChange(e.target.value); if (e.target.value) setOpen(false); }}
            aria-label="Due date"
            className="h-8 rounded-[8px] bg-transparent px-2 text-[14px] text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] outline-none"
          />
          {todo.dueDate && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="h-8 rounded-[6px] px-3 text-[13px] text-a-muted transition-colors duration-[120ms] hover:text-a-ink"
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
          className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
          aria-label={`Options for ${todo.text}`}
        >
          <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
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

/**
 * The last row of a group, or under an ungrouped table: the DS ghost "Add task"
 * button (showcase 260). Click it, type a title, Enter adds it there.
 */
function NewTaskRow({ label, onAdd }: { label: string; onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onAdd(trimmed);
    setTitle('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={topBarPill} aria-label={`Add task to ${label}`}>
        <Plus className="size-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
        Add task
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-a-faint">
      <Plus className="size-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
      <input
        autoFocus
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setTitle(''); setOpen(false); }
        }}
        placeholder="What needs to be done?"
        aria-label={`New task in ${label}`}
        className="h-7 w-full max-w-[320px] rounded-[4px] bg-transparent px-1 text-[13px] text-a-ink outline-none placeholder:text-a-faint focus-visible:bg-a-line-soft"
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
      placeholder="—"
      aria-label={ariaLabel}
      className={cn(CONTROL_ROW, 'placeholder:italic placeholder:text-a-faint', className)}
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
  // Only select/multi (a popover) need this; harmless elsewhere since unused.
  const [popoverOpen, setPopoverOpen] = useState(false);

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
              'flex size-[17px] items-center justify-center rounded-[6px] transition-colors duration-[120ms]',
              on ? 'bg-a-accent text-a-surface' : 'shadow-[inset_0_0_0_1.5px_var(--a-line)]',
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
          // DS numeric column: right-aligned, mono, 11px, secondary ink.
          className={def.kind === 'number' ? 'text-right font-mono text-[11px] text-a-muted' : undefined}
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
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(CONTROL, 'flex min-h-8 flex-wrap items-center gap-1 py-1')} aria-label={label}>
              {chosen.length === 0 && <span className="italic text-a-faint">—</span>}
              {chosen.map((o) => (
                // A single select reads as plain text, as the prototype's Stage column does;
                // a multi-select keeps its coloured chips, which are what tell the values apart.
                def.kind === 'select'
                  ? <span key={o.id}>{o.label}</span>
                  : <span key={o.id} className={cn('rounded-[3px] px-2 py-0.5 text-[12px] font-medium', OPTION_CHIP_CLASS[o.color])}>{o.label}</span>
              ))}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <p className="mb-2 text-[12px] font-semibold text-a-muted">{def.name}</p>
            <FieldValueEditor
              field={def}
              value={value}
              onChange={onChange}
              onSelectOption={def.kind === 'multi' ? () => setPopoverOpen(false) : undefined}
            />
          </PopoverContent>
        </Popover>
      );
    }
  }
}

