/**
 * The table layout: one row per task, one column per property — the task's own
 * title, status, quadrant and due date, then each custom field in field order.
 *
 * Every cell edits in place. Text, numbers and dates save on Enter or when the
 * cell loses focus; status, quadrant, select, multi-select and checkbox save as
 * soon as they change. A column header sorts by that column: ascending, then
 * descending, then back to the manual order. The sort is the filter's, so it is
 * kept in saved views like any other.
 *
 * Tasks from every quadrant share one list here, so rows are ordered with
 * compareAcrossQuadrants. With a group-by field set, rows are grouped under one
 * heading per option.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldValueEditor } from '@/components/fields/FieldValueEditor';
import { QUADRANTS, type Quadrant, type Todo, type TodoStatus } from '@/types/todo';
import type { TaskCompare } from '@/lib/quadrantBuckets';
import {
  FIELD_EMPTY, fieldSortKey, groupByField, type FilterState, type TaskGroup,
} from '@/lib/taskFilters';
import { OPTION_CHIP_CLASS, OPTION_DOT_CLASS, selectedOptions } from '@/lib/fieldValues';
import type { FieldDef, FieldValue, TaskFieldValues } from '@/types/fields';

type SortBy = FilterState['sortBy'];

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
  onStatusChange: (id: string, status: TodoStatus) => void;
  onUpdate: (id: string, changes: Partial<Todo>) => void;
  onSetFieldValue: (taskId: string, fieldId: string, value: FieldValue | null) => void;
  onOpen: (todo: Todo) => void;
}

const STATUS_OPTIONS: Array<{ value: TodoStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

const CELL = 'px-2 py-1 align-middle';
const CONTROL = cn(
  'h-8 w-full rounded-[9px] border-0 bg-transparent px-2 text-left text-[13.5px] text-a-ink',
  'transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]',
  'focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a-accent',
);

export function TaskTableView({
  todos, showDone, compare, sortBy, sortDir, onSortChange, groupField,
  fieldDefs, fieldValues, onStatusChange, onUpdate, onSetFieldValue, onOpen,
}: TaskTableViewProps) {
  const groups: TaskGroup[] = useMemo(() => {
    if (groupField) return groupByField(todos, showDone, compare, groupField, fieldValues);
    const rows = todos.filter((t) => showDone || t.status !== 'done').sort(compare);
    return [{ key: '', label: '', color: null, tasks: rows }];
  }, [todos, showDone, compare, groupField, fieldValues]);

  const columnCount = 4 + fieldDefs.length;
  const rowCount = groups.reduce((n, g) => n + g.tasks.length, 0);

  const header = (label: string, key: SortBy, className?: string) => {
    const active = sortBy === key;
    const next = (): [SortBy, 'asc' | 'desc'] => {
      if (!active) return [key, 'asc'];
      if (sortDir === 'asc') return [key, 'desc'];
      return ['order', 'asc'];
    };
    return (
      <th
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn('px-2 py-2 text-left align-bottom font-normal', className)}
      >
        <button
          type="button"
          onClick={() => onSortChange(...next())}
          className={cn(
            'flex items-center gap-1 rounded-[7px] px-2 py-1 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150',
            active ? 'text-a-ink' : 'text-a-faint hover:text-a-ink',
          )}
        >
          {label}
          {active && (sortDir === 'asc'
            ? <ArrowUp className="size-3" strokeWidth={2.75} aria-hidden />
            : <ArrowDown className="size-3" strokeWidth={2.75} aria-hidden />)}
        </button>
      </th>
    );
  };

  return (
    <div className="w-full overflow-x-auto animate-fade-in">
      <table className="w-full min-w-max border-collapse text-[13.5px]">
        <thead>
          <tr className="border-b border-a-line-soft">
            {header('Title', 'title', 'sticky left-0 z-10 min-w-[260px] bg-a-bg')}
            {header('Status', 'status')}
            {header('Quadrant', 'quadrant')}
            {header('Due', 'due-date')}
            {fieldDefs.map((def) => <Fragment key={def.id}>{header(def.name, fieldSortKey(def.id))}</Fragment>)}
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
                fieldDefs={fieldDefs}
                values={fieldValues[todo.id]}
                onStatusChange={onStatusChange}
                onUpdate={onUpdate}
                onSetFieldValue={onSetFieldValue}
                onOpen={onOpen}
              />
            ))}

            {group.tasks.length === 0 && groupField && group.key !== FIELD_EMPTY && (
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

interface TaskTableRowProps {
  todo: Todo;
  fieldDefs: FieldDef[];
  values: Record<string, FieldValue> | undefined;
  onStatusChange: TaskTableViewProps['onStatusChange'];
  onUpdate: TaskTableViewProps['onUpdate'];
  onSetFieldValue: TaskTableViewProps['onSetFieldValue'];
  onOpen: TaskTableViewProps['onOpen'];
}

function TaskTableRow({ todo, fieldDefs, values, onStatusChange, onUpdate, onSetFieldValue, onOpen }: TaskTableRowProps) {
  const isDone = todo.status === 'done';
  const quadrant = QUADRANTS.find((q) => q.id === todo.quadrant) ?? QUADRANTS[0];

  return (
    <tr className="group border-b border-a-line-soft/60">
      <td className={cn(CELL, 'sticky left-0 z-10 bg-a-bg')}>
        <div className="flex items-center gap-1">
          <CellInput
            value={todo.text}
            ariaLabel="Title"
            className={cn('min-w-0 flex-1 font-medium', isDone && 'text-a-faint line-through')}
            onCommit={(text) => {
              const trimmed = text.trim();
              if (trimmed && trimmed !== todo.text) onUpdate(todo.id, { text: trimmed });
              return trimmed ? trimmed : todo.text;
            }}
          />
          <button
            type="button"
            onClick={() => onOpen(todo)}
            className="flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-a-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:text-a-ink"
            aria-label={`Open ${todo.text}`}
          >
            <PanelRightOpen className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </td>

      <td className={cn(CELL, 'min-w-[130px]')}>
        <Select value={todo.status} onValueChange={(v) => onStatusChange(todo.id, v as TodoStatus)}>
          <SelectTrigger size="sm" className={cn(CONTROL, 'shadow-none')} aria-label={`Status of ${todo.text}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>

      <td className={cn(CELL, 'min-w-[140px]')}>
        <Select value={quadrant.id} onValueChange={(v) => onUpdate(todo.id, { quadrant: v as Quadrant })}>
          <SelectTrigger size="sm" className={cn(CONTROL, 'shadow-none')} aria-label={`Quadrant of ${todo.text}`}>
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

      <td className={cn(CELL, 'min-w-[150px]')}>
        <CellInput
          type="date"
          value={todo.dueDate ?? ''}
          ariaLabel={`Due date of ${todo.text}`}
          onCommit={(date) => {
            if (date !== (todo.dueDate ?? '')) onUpdate(todo.id, { dueDate: date });
            return date;
          }}
        />
      </td>

      {fieldDefs.map((def) => (
        <td key={def.id} className={cn(CELL, 'min-w-[150px]')}>
          <FieldCell
            def={def}
            value={values?.[def.id]}
            taskName={todo.text}
            onChange={(value) => onSetFieldValue(todo.id, def.id, value)}
          />
        </td>
      ))}
    </tr>
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
      className={cn(CONTROL, 'placeholder:text-a-faint/60', className)}
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
    case 'checkbox':
      return (
        <label className={cn(CONTROL, 'flex cursor-pointer items-center gap-2')}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked ? true : null)}
            className="size-3.5 accent-[var(--a-accent)]"
            aria-label={label}
          />
        </label>
      );

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
            <button type="button" className={cn(CONTROL, 'flex flex-wrap items-center gap-1 py-1 h-auto min-h-8')} aria-label={label}>
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
