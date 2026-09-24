/**
 * A database's records in columns, one per value of one of its fields.
 *
 * The same board the tasks have, over records instead: the drop rules are
 * literally the task board's (boardDrop, boardCardId, parseBoardCardId — they
 * only ever touch ids and field values), and the grouping is the shared
 * groupItemsByField. What differs is the card, because a record has no status,
 * due date or reminder, and that a record cannot be "done", so nothing is
 * hidden from a column.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Check, ChevronDown, Columns3, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { RecordCard } from '@/components/databases/RecordCard';
import {
  BOARD_COLUMN_PREFIX, boardCardId, boardDrop, parseBoardCardId,
} from '@/components/tasks/TaskBoardView';
import { groupItemsByField, isGroupableField, type FieldGroup } from '@/lib/taskFilters';
import { OPTION_DOT_CLASS } from '@/lib/fieldValues';
import { FIELD_KIND_LABELS, type FieldDef, type FieldValue, type TaskFieldValues } from '@/types/fields';
import type { ApiDatabaseRow } from '@/lib/api';

export interface RecordBoardProps {
  rows: ApiDatabaseRow[];
  fields: FieldDef[];
  /** recordId → fieldId → value. */
  values: TaskFieldValues;
  /** The field the columns come from, or null until one is chosen. */
  groupField: FieldDef | null;
  onGroupFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
  onSetValue: (recordId: string, fieldId: string, value: FieldValue | null) => void;
  /** Adds a record already in that column. */
  onAdd?: (title: string, columnKey: string) => void;
}

/** Records keep the order the database gives them; a column has no order of its own. */
const byOrder = (a: ApiDatabaseRow, b: ApiDatabaseRow) => a.rowOrder - b.rowOrder || a.createdAt - b.createdAt;

export function RecordBoard({
  rows, fields, values, groupField, onGroupFieldChange, onManageFields, onSetValue, onAdd,
}: RecordBoardProps) {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const columns = useMemo<Array<FieldGroup<ApiDatabaseRow>>>(
    () => (groupField ? groupItemsByField(rows, byOrder, groupField, values, { includeEmpty: true }) : []),
    [rows, groupField, values],
  );

  // The right-edge fade is a "there's more" hint, not decoration — it must
  // disappear once scrolled to the actual end, or it lies about the last column.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) { setCanScrollRight(false); return; }
    const update = () => setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
    update();
    el.addEventListener('scroll', update);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { el.removeEventListener('scroll', update); observer.disconnect(); };
  }, [columns]);

  const sensors = useSensors(
    // A small distance, so a click on a card is not mistaken for a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const groupable = fields.filter(isGroupableField);

  if (!groupField) {
    return (
      <BoardSetup
        groupableFields={groupable}
        otherFields={fields.filter((f) => !isGroupableField(f))}
        onGroupFieldChange={onGroupFieldChange}
        onManageFields={onManageFields}
      />
    );
  }

  const activeRecordId = activeCardId ? parseBoardCardId(activeCardId)?.taskId : undefined;
  const active = activeRecordId ? rows.find((r) => r.id === activeRecordId) : undefined;

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    setActiveCardId(null);
    const change = boardDrop(String(dragged.id), over ? String(over.id) : null, groupField, values);
    if (change) onSetValue(change.taskId, groupField.id, change.value);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active: dragged }) => setActiveCardId(String(dragged.id))}
      onDragCancel={() => setActiveCardId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="animate-fade-in">
        <div className="mb-3 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:text-a-ink"
                aria-label={`Columns from ${groupField.name}`}
              >
                <Columns3 className="size-3.5" strokeWidth={2.5} aria-hidden />
                Columns: <span className="font-semibold text-a-ink">{groupField.name}</span>
                <ChevronDown className="size-3" strokeWidth={2.75} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {groupable.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => onGroupFieldChange(f.id)}>
                  <Check className={cn('size-3.5', f.id !== groupField.id && 'opacity-0')} aria-hidden />
                  {f.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onManageFields}>
                <Plus className="size-3.5" aria-hidden /> Create a column…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onGroupFieldChange('')}>
                Choose later
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="relative">
          <div ref={scrollRef} className="w-full overflow-x-auto pb-3">
            <div className="flex min-w-max items-start gap-4">
              {columns.map((column) => (
                <BoardColumn
                  key={column.key}
                  fieldId={groupField.id}
                  column={column}
                  fields={fields}
                  values={values}
                  onAdd={onAdd}
                />
              ))}
            </div>
          </div>
          {canScrollRight && (
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-a-bg to-transparent"
              aria-hidden
            />
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[272px] rotate-[1.5deg] cursor-grabbing shadow-lg">
            <RecordCard record={active} fields={fields} values={values[active.id]} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface BoardColumnProps {
  fieldId: string;
  column: FieldGroup<ApiDatabaseRow>;
  fields: FieldDef[];
  values: TaskFieldValues;
  onAdd?: (title: string, columnKey: string) => void;
}

function BoardColumn({ fieldId, column, fields, values, onAdd }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${BOARD_COLUMN_PREFIX}${column.key}` });
  const headingId = `record-board-${fieldId}-${column.key}`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex w-[292px] flex-shrink-0 flex-col rounded-[18px] bg-[color-mix(in_srgb,var(--a-ink)_4%,transparent)] p-2.5"
    >
      <header className="mb-2 flex items-center gap-2 px-1.5 pt-0.5">
        <span
          className={cn('size-[9px] flex-shrink-0 rounded-full', column.color ? OPTION_DOT_CLASS[column.color] : 'shadow-[inset_0_0_0_1.5px_var(--a-line)]')}
          aria-hidden
        />
        <h2 id={headingId} className="min-w-0 truncate font-display text-[16px] leading-tight text-a-ink">{column.label}</h2>
        <span className="text-[12.5px] font-bold tabular-nums text-a-muted">{column.items.length}</span>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[96px] flex-col gap-2 rounded-[14px] p-0.5 transition-[background-color,box-shadow] duration-150',
          isOver && 'bg-a-row-hover shadow-[inset_0_0_0_1.5px_var(--a-accent)]',
        )}
      >
        {column.items.map((record) => (
          <DraggableRecord
            key={record.id}
            columnKey={column.key}
            record={record}
            fields={fields}
            values={values}
          />
        ))}
        {column.items.length === 0 && (
          <p className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[13px] text-a-faint">
            Drop a record here
          </p>
        )}
      </div>

      {onAdd && <ColumnComposer columnLabel={column.label} onAdd={(title) => onAdd(title, column.key)} />}
    </section>
  );
}

function DraggableRecord({
  columnKey, record, fields, values,
}: { columnKey: string; record: ApiDatabaseRow; fields: FieldDef[]; values: TaskFieldValues }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: boardCardId(columnKey, record.id) });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable record"
      className={cn('cursor-grab touch-none rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-a-accent', isDragging && 'opacity-40')}
    >
      <RecordCard record={record} fields={fields} values={values[record.id]} />
    </div>
  );
}

/** "+ Add" at the foot of a column: type a title, Enter creates it in that column. */
function ColumnComposer({ columnLabel, onAdd }: { columnLabel: string; onAdd: (title: string) => void }) {
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-left text-[13px] text-a-faint transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
        aria-label={`Add record to ${columnLabel}`}
      >
        <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
        Add
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={title}
      maxLength={255}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setTitle(''); setOpen(false); }
      }}
      placeholder="What is it?"
      aria-label={`New record in ${columnLabel}`}
      className="mt-1.5 h-9 w-full rounded-[12px] bg-a-bg px-2.5 text-[13.5px] text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--a-accent)]"
    />
  );
}

interface BoardSetupProps {
  groupableFields: FieldDef[];
  otherFields: FieldDef[];
  onGroupFieldChange: (fieldId: string) => void;
  onManageFields: () => void;
}

/** Shown until the board has a field to make columns from. */
function BoardSetup({ groupableFields, otherFields, onGroupFieldChange, onManageFields }: BoardSetupProps) {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center py-16 text-center animate-fade-in">
      <Columns3 className="mb-3 size-6 text-a-faint" strokeWidth={2.25} aria-hidden />
      <p className="font-display text-[20px] text-a-ink">Choose the columns</p>

      {groupableFields.length === 0 ? (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            Columns come from a Select or Multi-select column (one per option) or a Checkbox column
            (Checked and Not checked).
            {otherFields.length > 0 && (
              <> {otherFields.map((f) => `${f.name} (${FIELD_KIND_LABELS[f.kind]})`).join(', ')} can't make columns.</>
            )}
          </p>
          <button
            type="button"
            onClick={onManageFields}
            className="mt-4 flex items-center gap-1.5 rounded-full bg-a-accent px-4 py-2 text-[13.5px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600"
          >
            <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
            Create a column
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-a-muted">
            Pick a column. Each of its values becomes a board column, and dragging a record between
            them changes it.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {groupableFields.map((field) => (
              <button
                key={field.id}
                type="button"
                onClick={() => onGroupFieldChange(field.id)}
                className="rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-150 hover:bg-a-row-hover"
              >
                {field.name}
                <span className="ml-1.5 font-normal text-a-faint">{FIELD_KIND_LABELS[field.kind]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
