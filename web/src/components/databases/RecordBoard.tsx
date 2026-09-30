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
import { NO_VALUE_DOT_CLASS, OPTION_INK_DOT_CLASS } from '@/lib/fieldValues';
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

  const columns = useMemo<Array<FieldGroup<ApiDatabaseRow>>>(
    () => (groupField ? groupItemsByField(rows, byOrder, groupField, values, { includeEmpty: true }) : []),
    [rows, groupField, values],
  );

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
        <div className="relative">
          <div className="w-full overflow-x-auto pb-3">
            <div className="flex min-w-max items-start gap-4">
              {columns.map((column) => (
                <BoardColumn
                  key={column.key}
                  fieldId={groupField.id}
                  column={column}
                  fields={fields}
                  values={values}
                  laneFieldId={groupField.id}
                  onAdd={onAdd}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[272px] rotate-[1.5deg] cursor-grabbing shadow-lg">
            <RecordCard record={active} fields={fields} values={values[active.id]} laneFieldId={groupField.id} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface BoardColumnProps {
  fieldId: string;
  laneFieldId: string;
  column: FieldGroup<ApiDatabaseRow>;
  fields: FieldDef[];
  values: TaskFieldValues;
  onAdd?: (title: string, columnKey: string) => void;
}

function BoardColumn({ fieldId, column, fields, values, laneFieldId, onAdd }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${BOARD_COLUMN_PREFIX}${column.key}` });
  const [composing, setComposing] = useState(false);
  const headingId = `record-board-${fieldId}-${column.key}`;

  // Showcase 752–759: a --gray-100 lane, 8px radius/padding/gap; header dot (the tag's ink) +
  // name + mono count; the empty lane is a dashed drop target.
  return (
    <section
      aria-labelledby={headingId}
      className="group/lane relative flex w-[292px] flex-shrink-0 flex-col gap-2 rounded-[8px] bg-a-line-soft p-2"
    >
      <header className="flex items-center gap-2 px-1.5 py-1">
        <span
          className={cn('size-2 flex-shrink-0 rounded-full', column.color ? OPTION_INK_DOT_CLASS[column.color] : NO_VALUE_DOT_CLASS)}
          aria-hidden
        />
        <h2 id={headingId} className="min-w-0 truncate text-[13px] font-semibold text-a-ink">{column.label}</h2>
        <span className="font-mono text-[11px] tabular-nums text-a-faint">{column.items.length}</span>
        <div className="flex-1" />
        {onAdd && (
          // Not in the prototype's lane, so it stays out of sight until the lane is hovered.
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label={`Add record to ${column.label}`}
            className="flex size-6 items-center justify-center rounded-[4px] text-a-muted opacity-0 transition-opacity duration-[120ms] group-hover/lane:opacity-100 focus-visible:opacity-100 hover:bg-a-line hover:text-a-ink"
          >
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-col gap-2 rounded-[8px] transition-[background-color,box-shadow] duration-[120ms]',
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
            laneFieldId={laneFieldId}
          />
        ))}
        {column.items.length === 0 && (
          <div className="rounded-[8px] border border-dashed border-a-line-strong px-3 py-5 text-center text-[12px] leading-normal text-a-faint">
            Drop a record here.
          </div>
        )}
      </div>

      {onAdd && composing && (
        <ColumnComposer columnLabel={column.label} onDone={() => setComposing(false)} onAdd={(title) => onAdd(title, column.key)} />
      )}
    </section>
  );
}

function DraggableRecord({
  columnKey, record, fields, values, laneFieldId,
}: { columnKey: string; record: ApiDatabaseRow; fields: FieldDef[]; values: TaskFieldValues; laneFieldId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: boardCardId(columnKey, record.id) });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable record"
      className={cn('cursor-grab touch-none rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-a-accent', isDragging && 'opacity-40')}
    >
      <RecordCard record={record} fields={fields} values={values[record.id]} laneFieldId={laneFieldId} />
    </div>
  );
}

/** The lane header's "+" opens this: type a title, Enter creates it in that lane. */
function ColumnComposer({ columnLabel, onAdd, onDone }: { columnLabel: string; onAdd: (title: string) => void; onDone: () => void }) {
  const [title, setTitle] = useState('');

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onAdd(trimmed);
    setTitle('');
    onDone();
  };

  return (
    <input
      autoFocus
      value={title}
      maxLength={255}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setTitle(''); onDone(); }
      }}
      placeholder="What is it?"
      aria-label={`New record in ${columnLabel}`}
      className="h-9 w-full rounded-[8px] bg-a-surface px-2.5 text-[14px] text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--a-accent)]"
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
      <Columns3 className="mb-3 size-6 text-a-faint" strokeWidth={1.75} aria-hidden />
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
            className="mt-4 flex items-center gap-1.5 rounded-[6px] bg-a-accent px-4 py-2 text-[14px] font-semibold text-a-surface transition-colors duration-[120ms] hover:bg-a-accent-600"
          >
            <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
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
                className="rounded-[6px] px-3.5 py-1.5 text-[14px] font-semibold text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] transition-colors duration-[120ms] hover:bg-a-row-hover"
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
