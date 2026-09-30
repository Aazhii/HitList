/**
 * A database's records as a table: Title, then a column per field.
 *
 * The same shape as the tasks table, minus what only a task has — no status,
 * quadrant or due date, and no reminders. Titles wrap and edit in place, every
 * field cell edits in place, and a column header carries the field's own menu,
 * so a column is changed from where it is used. Press and hold a column's
 * name to drag it to a new position; the body rows follow automatically
 * since they render the same `fields` array the drag reorders.
 *
 * Deliberately not a copy of TaskTableView: that one is built on Todo, with
 * built-in task columns and a saved view's own column order. A database has
 * no "views", so its columns reorder by writing straight to each field's own
 * `fieldOrder` instead. Sharing it would mean threading "which built-in
 * columns exist" through every row, for two screens that differ in more than
 * they share. The cells that do the real work — the field editors — are
 * shared.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
  AlignLeft, ArrowDown, ArrowLeftToLine, ArrowRightToLine, ArrowUp, Calendar, Check, ChevronDown,
  ChevronRight, CircleChevronDown, Copy, EyeOff, Hash, List, MoreHorizontal, Pencil,
  Pin, Plus, Repeat2, Rows3, Sigma, SquareCheck, Text as TextIcon, Trash2, WrapText, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldValueEditor } from '@/components/fields/FieldValueEditor';
import { TextFieldCell } from '@/components/databases/TextFieldCell';
import { OPTION_CHIP_CLASS, selectedOptions } from '@/lib/fieldValues';
import type { ApiDatabaseRow } from '@/lib/api';
import { FIELD_KIND_LABELS, type FieldDef, type FieldKind, type FieldValue } from '@/types/fields';
import type { DatabaseTaskLinking } from '@/pages/DatabasesPage';

/** Every kind offered from "Change type" — same six as field creation, in the same order. */
const CHANGE_TYPE_KINDS: readonly FieldKind[] = ['text', 'longtext', 'number', 'select', 'multi', 'date', 'checkbox'];

/** The showcase's literal per-type icon (`TYPES` array, `HitList Notion x Zoho.dc.html` line 1389). */
const KIND_ICON: Record<FieldDef['kind'], typeof AlignLeft> = {
  text: AlignLeft,
  longtext: TextIcon,
  number: Hash,
  select: CircleChevronDown,
  multi: List,
  date: Calendar,
  checkbox: SquareCheck,
};

/** How many of a field's cells hold a real value — the DataPrep-style fill bar under a header. */
function fillCount(field: FieldDef, rows: ApiDatabaseRow[], values: Record<string, Record<string, FieldValue>>): number {
  return rows.filter((row) => {
    const v = values[row.id]?.[field.id];
    if (v === undefined || v === null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;
}

/** The showcase's literal calculate menu (line 1694) — `sum`/`avg`/`min`/`max` only offered for `number`. */
const CALC_OPTIONS: ReadonlyArray<{ key: string; label: string; numberOnly?: boolean }> = [
  { key: '', label: 'None' },
  { key: 'count', label: 'Count all' },
  { key: 'values', label: 'Count values' },
  { key: 'empty', label: 'Count empty' },
  { key: 'pct', label: 'Percent empty' },
  { key: 'sum', label: 'Sum', numberOnly: true },
  { key: 'avg', label: 'Average', numberOnly: true },
  { key: 'min', label: 'Min', numberOnly: true },
  { key: 'max', label: 'Max', numberOnly: true },
];

function calcText(key: string, field: FieldDef, rows: ApiDatabaseRow[], values: Record<string, Record<string, FieldValue>>): string {
  if (!key) return '';
  const raw = rows.map((r) => values[r.id]?.[field.id]);
  const filled = raw.filter((v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  const nums = filled.map(Number).filter((n) => !Number.isNaN(n));
  const n = rows.length;
  switch (key) {
    case 'count': return `Count ${n}`;
    case 'values': return `Values ${filled.length}`;
    case 'empty': return `Empty ${n - filled.length}`;
    case 'pct': return `${n ? Math.round((100 * (n - filled.length)) / n) : 0}% empty`;
    case 'sum': return `Sum ${nums.reduce((a, b) => a + b, 0)}`;
    case 'avg': return `Average ${nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : 0}`;
    case 'min': return `Min ${nums.length ? Math.min(...nums) : '–'}`;
    case 'max': return `Max ${nums.length ? Math.max(...nums) : '–'}`;
    default: return '';
  }
}

/** A readable group label for select/multi/checkbox — the only groupable kinds. */
function groupLabelFor(field: FieldDef, value: FieldValue | undefined): string {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return `No ${field.name}`;
  if (field.kind === 'checkbox') return value === true ? 'Checked' : `No ${field.name}`;
  const optionId = Array.isArray(value) ? value[0] : String(value);
  return field.options.find((o) => o.id === optionId)?.label ?? `No ${field.name}`;
}

export interface RecordTableProps {
  rows: ApiDatabaseRow[];
  fields: FieldDef[];
  /** The Title column's own header label — renamable, defaults to "Title". */
  titleLabel: string;
  onRenameTitleLabel: (label: string) => void;
  /** recordId → fieldId → value. */
  values: Record<string, Record<string, FieldValue>>;
  loading: boolean;
  onAdd: (title: string) => void;
  onRename: (recordId: string, title: string) => void;
  onDelete: (recordId: string) => void;
  onSetValue: (recordId: string, fieldId: string, value: FieldValue | null) => void;
  onEditField: (fieldId: string) => void;
  onDeleteField: (fieldId: string) => void;
  onCreateField: () => void;
  /** A column was dragged to a new position; `fieldIds` is the full new order. */
  onReorderFields: (fieldIds: string[]) => void;
  /** A text column's "@" → add to quadrant menu; absent turns it off. */
  linking?: DatabaseTaskLinking;

  sort: { fieldId: string; dir: 1 | -1 } | null;
  onSortField: (fieldId: string, dir: 1 | -1) => void;
  onClearSort: () => void;
  groupFieldId: string | null;
  onGroupField: (fieldId: string) => void;
  calc: Record<string, string>;
  onCalcField: (fieldId: string, key: string) => void;
  frozenFieldId: string | null;
  onFreezeField: (fieldId: string) => void;
  wrapFieldIds: string[];
  onWrapField: (fieldId: string) => void;
  /** fieldId → px. Missing means DEFAULT_COL_WIDTH. */
  colWidths: Record<string, number>;
  onResizeField: (fieldId: string, width: number) => void;
  onHideField: (fieldId: string) => void;
  onInsertField: (fieldId: string, side: 'left' | 'right') => void;
  onDuplicateField: (field: FieldDef) => void;
  onChangeFieldKind: (field: FieldDef, kind: FieldDef['kind']) => void;
}

const CELL = 'px-2 py-1.5 align-top';

/** Column sizing. The design gives every column an explicit width (showcase 619). */
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 96;
const CONTROL = cn(
  'w-full rounded-[8px] border-0 bg-transparent px-2 text-left text-[14px] text-a-ink',
  'transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]',
  'focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a-accent',
);
const CONTROL_ROW = cn(CONTROL, 'h-8');

export function RecordTable({
  rows, fields, titleLabel, onRenameTitleLabel, values, loading,
  onAdd, onRename, onDelete, onSetValue, onEditField, onDeleteField, onCreateField, onReorderFields, linking,
  sort, onSortField, onClearSort, groupFieldId, onGroupField, calc, onCalcField,
  frozenFieldId, onFreezeField, wrapFieldIds, onWrapField, colWidths, onResizeField, onHideField, onInsertField, onDuplicateField, onChangeFieldKind,
}: RecordTableProps) {
  const columnCount = 2 + fields.length;
  const hasCalc = Object.keys(calc).length > 0;
  const groupField = fields.find((f) => f.id === groupFieldId) ?? null;

  const sensors = useSensors(
    // The whole column name is the drag target (no separate grip icon), so it
    // takes a deliberate press-and-hold rather than a small drag distance —
    // otherwise every plain click would have to be read as "not quite a drag".
    useSensor(PointerSensor, { activationConstraint: { delay: 120, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = fields.map((f) => f.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorderFields(arrayMove(ids, from, to));
  };

  const renderRow = (row: ApiDatabaseRow) => (
    <tr key={row.id} className="group min-h-9 border-b border-a-line-soft hover:bg-a-row-alt">
      <td className={cn(CELL, 'min-w-[280px] border-r border-a-line-soft')}>
        <div className="flex items-start gap-1">
          <TitleCell
            title={row.title}
            onCommit={(title) => { if (title && title !== row.title) onRename(row.id, title); }}
          />
          <RecordMenu title={row.title} onDelete={() => onDelete(row.id)} />
        </div>
      </td>

      {fields.map((field) => (
        <td
          key={field.id}
          style={{ width: colWidths[field.id] ?? DEFAULT_COL_WIDTH }}
          className={cn(
            CELL, 'border-r border-a-line-soft',
            field.id === frozenFieldId && 'sticky left-[280px] z-[1] bg-a-surface',
            // A text area always wraps — that is the kind's whole purpose — so
            // it does not wait on the column's own Wrap content toggle.
            (field.kind === 'longtext' || wrapFieldIds.includes(field.id)) && 'whitespace-normal',
          )}
        >
          <FieldCell
            def={field}
            value={values[row.id]?.[field.id]}
            recordId={row.id}
            recordName={row.title}
            onChange={(value) => onSetValue(row.id, field.id, value)}
            linking={linking}
          />
        </td>
      ))}

      <td className={cn(CELL, 'border-r border-a-line-soft')} aria-hidden />
    </tr>
  );

  return (
    <div className="w-full overflow-x-auto animate-fade-in">
      {/* DndContext must wrap the table, not sit inside <thead>: it renders a
          hidden accessibility <div>, which HTML forbids as a <thead> child —
          the browser would otherwise silently relocate it, taking the table's
          layout with it. React context reaches useSortable() either way. */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <table className="w-full min-w-max border-collapse text-[14px]">
          <thead>
            <tr className="h-9 border-b border-a-line bg-a-bg">
              <th scope="col" className="h-9 min-w-[280px] border-r border-a-line-soft px-2 text-left align-middle font-normal">
                <TitleHeaderCell label={titleLabel} onCommit={onRenameTitleLabel} />
              </th>
              <SortableContext items={fields.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
                {fields.map((field) => (
                  <FieldHeader
                    key={field.id}
                    field={field}
                    filled={fillCount(field, rows, values)}
                    total={rows.length}
                    sortDir={sort?.fieldId === field.id ? sort.dir : null}
                    grouped={groupFieldId === field.id}
                    calc={calc[field.id] ?? ''}
                    frozen={frozenFieldId === field.id}
                    wrapped={wrapFieldIds.includes(field.id)}
                    width={colWidths[field.id] ?? DEFAULT_COL_WIDTH}
                    onResize={(w) => onResizeField(field.id, w)}
                    onEdit={() => onEditField(field.id)}
                    onDelete={() => onDeleteField(field.id)}
                    onSort={(dir) => onSortField(field.id, dir)}
                    onClearSort={onClearSort}
                    onGroup={() => onGroupField(field.id)}
                    onCalc={(key) => onCalcField(field.id, key)}
                    onFreeze={() => onFreezeField(field.id)}
                    onHide={() => onHideField(field.id)}
                    onWrap={() => onWrapField(field.id)}
                    onInsertLeft={() => onInsertField(field.id, 'left')}
                    onInsertRight={() => onInsertField(field.id, 'right')}
                    onDuplicate={() => onDuplicateField(field)}
                    onChangeKind={(kind) => onChangeFieldKind(field, kind)}
                  />
                ))}
              </SortableContext>
              <th scope="col" className="h-9 w-11 border-r border-a-line-soft px-2 text-left align-middle font-normal">
                <button
                  type="button"
                  onClick={onCreateField}
                  className="flex size-7 items-center justify-center rounded-[6px] text-a-faint transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
                  aria-label="Add a column"
                >
                  <Plus className="size-4" strokeWidth={1.75} />
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            {groupField ? (
              Array.from(
                rows.reduce((groups, row) => {
                  const label = groupLabelFor(groupField, values[row.id]?.[groupField.id]);
                  (groups.get(label) ?? groups.set(label, []).get(label)!).push(row);
                  return groups;
                }, new Map<string, ApiDatabaseRow[]>()),
              ).map(([label, groupRows]) => (
                <Fragment key={`group-${label}`}>
                  <tr className="border-b border-a-line-soft">
                    <td colSpan={columnCount} className="px-2 py-1.5">
                      <span className="inline-flex items-center gap-2 rounded-[3px] bg-a-surface-2 px-2 py-0.5 text-[13px] text-a-ink">
                        {label}
                        <span className="text-a-faint">{groupRows.length}</span>
                      </span>
                    </td>
                  </tr>
                  {groupRows.map(renderRow)}
                </Fragment>
              ))
            ) : (
              rows.map(renderRow)
            )}

            {hasCalc && (
              <tr className="h-8 border-b border-a-line-soft">
                <td className="border-r border-a-line-soft" aria-hidden />
                {fields.map((field) => (
                  <td
                    key={field.id}
                    className={cn(
                      'border-r border-a-line-soft px-2 text-right text-[12px] text-a-faint',
                      field.id === frozenFieldId && 'sticky left-[280px] z-[1] bg-a-bg',
                    )}
                  >
                    {calcText(calc[field.id] ?? '', field, rows, values)}
                  </td>
                ))}
                <td className="border-r border-a-line-soft" aria-hidden />
              </tr>
            )}

            <tr>
              <td colSpan={columnCount} className="px-2 py-0.5">
                <NewRecordRow onAdd={onAdd} />
              </td>
            </tr>
          </tbody>
        </table>
      </DndContext>

      {rows.length === 0 && !loading && (
        <p className="px-4 py-8 text-center text-[14px] text-a-faint">
          No records yet. Add one above, and give it columns with <span className="font-semibold">New column</span>.
        </p>
      )}
    </div>
  );
}

interface FieldHeaderProps {
  field: FieldDef;
  filled: number;
  total: number;
  sortDir: 1 | -1 | null;
  grouped: boolean;
  calc: string;
  frozen: boolean;
  wrapped: boolean;
  width: number;
  onResize: (width: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onSort: (dir: 1 | -1) => void;
  onClearSort: () => void;
  onGroup: () => void;
  onCalc: (key: string) => void;
  onFreeze: () => void;
  onHide: () => void;
  onWrap: () => void;
  onInsertLeft: () => void;
  onInsertRight: () => void;
  onDuplicate: () => void;
  onChangeKind: (kind: FieldKind) => void;
}

/**
 * The column-header menu — the showcase's literal 13-action list (`mk(...)`
 * calls, `HitList Notion x Zoho.dc.html` lines ~1699–1716), minus one
 * deliberate omission: "Filter" (already live as a toolbar chip per field;
 * a second, non-functional entry here would just be decoration).
 *
 * "Change type" never coerces a value between kinds — it just changes which
 * kind is "on". A value written under a different kind is cloaked (server
 * decodes it as empty, storage untouched — see WorkspaceService.decode's
 * EncodedKind check) until the field's kind matches it again, at which
 * point it reappears exactly as it was. Matches Notion's own reversible
 * behavior, not a lossy one-way conversion.
 */
function FieldHeader({
  field, filled, total, sortDir, grouped, calc, frozen, wrapped, width, onResize,
  onEdit, onDelete, onSort, onClearSort, onGroup, onCalc, onFreeze, onHide, onWrap, onInsertLeft, onInsertRight, onDuplicate, onChangeKind,
}: FieldHeaderProps) {
  const [confirm, setConfirm] = useState(false);
  const [calcSub, setCalcSub] = useState(false);
  const [typeSub, setTypeSub] = useState(false);
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: field.id });
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100);

  const Icon = KIND_ICON[field.kind];
  const calcLabel = CALC_OPTIONS.find((o) => o.key === calc)?.label ?? 'None';

  return (
    <th
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, width }}
      scope="col"
      title={`${filled} of ${total} filled`}
      className={cn(
        'group/head relative h-9 border-r border-a-line-soft px-2 text-left align-middle font-normal',
        isDragging && 'z-10 bg-a-bg shadow-[var(--a-shadow-md)]',
        frozen && 'sticky left-[280px] z-[1] bg-a-bg',
      )}
    >
      {/* DataPrep's signature data-quality fill bar: share of rows with a real value. */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-a-dq-missing">
        <span className="block h-full bg-a-dq-valid" style={{ width: `${pct}%` }} />
      </span>

      {/* Drag the right edge to widen the column. Sits above the header's own
          press-and-hold reorder gesture, so it stops propagation. */}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${field.name}`}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startWidth = width;
          const move = (ev: PointerEvent) => onResize(Math.max(MIN_COL_WIDTH, startWidth + ev.clientX - startX));
          const up = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
          };
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        }}
        className="absolute inset-y-0 -right-1 z-[2] w-2 cursor-col-resize touch-none opacity-0 transition-opacity duration-[120ms] group-hover/head:opacity-100"
      >
        <span className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-a-accent" />
      </span>
      <span className="flex items-center gap-1.5">
        <Icon className="size-[15px] flex-shrink-0 text-a-ink" strokeWidth={1.75} aria-hidden />
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`${field.name}. Press and hold, then drag to reorder this column.`}
          // No visible grip icon: press-and-hold anywhere on the name itself
          // starts the drag (see the PointerSensor's delay below), so nothing
          // needs to be hovered first to find a handle.
          className="cursor-grab touch-none text-[13px] font-semibold whitespace-nowrap text-a-ink select-none active:cursor-grabbing"
        >
          {field.name}
        </span>
        {frozen && <Pin className="size-3 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />}
        {sortDir && (sortDir === 1 ? <ArrowUp className="size-3.5 flex-shrink-0 text-a-accent" strokeWidth={1.75} /> : <ArrowDown className="size-3.5 flex-shrink-0 text-a-accent" strokeWidth={1.75} />)}
        <DropdownMenu onOpenChange={(open) => { if (!open) { setConfirm(false); setCalcSub(false); setTypeSub(false); } }}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-[6px] text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover/head:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
              aria-label={`${field.name} column options`}
            >
              <ChevronDown className="size-3.5" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-56"
            // "Edit column…"/"Insert left/right" open another popover
            // (FieldsManagerDialog). Without this, Radix returns focus to this
            // trigger once the menu's own close animation finishes — after
            // that popover has already opened and focused its own input —
            // which reads as focus leaving the popover and closes it within a
            // couple hundred ms.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {calcSub ? (
              <>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCalcSub(false); }}>
                  <ChevronRight className="size-3.5 rotate-180" /> Calculate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {CALC_OPTIONS.filter((o) => !o.numberOnly || field.kind === 'number').map((o) => (
                  <DropdownMenuItem key={o.key} onClick={() => { onCalc(o.key); setCalcSub(false); }}>
                    {o.label === calcLabel && <Check className="size-3.5" />}
                    <span className={o.label === calcLabel ? '' : 'pl-[19px]'}>{o.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : typeSub ? (
              <>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setTypeSub(false); }}>
                  <ChevronRight className="size-3.5 rotate-180" /> Change type
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {CHANGE_TYPE_KINDS.map((kind) => (
                  <DropdownMenuItem key={kind} onClick={() => { onChangeKind(kind); setTypeSub(false); }}>
                    {kind === field.kind && <Check className="size-3.5" />}
                    <span className={kind === field.kind ? '' : 'pl-[19px]'}>{FIELD_KIND_LABELS[kind]}</span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : (
              <>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-3.5" /> Edit column…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setTypeSub(true); }}>
                  <Repeat2 className="size-3.5" /> <span className="flex-1">Change type</span>
                  <span className="text-[12px] text-a-faint">{FIELD_KIND_LABELS[field.kind]}</span>
                  <ChevronRight className="size-3.5 text-a-faint" />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onSort(1)}>
                  <ArrowUp className="size-3.5" /> Sort ascending
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSort(-1)}>
                  <ArrowDown className="size-3.5" /> Sort descending
                </DropdownMenuItem>
                {sortDir && (
                  <DropdownMenuItem onClick={onClearSort}>
                    <X className="size-3.5" /> Clear sort
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onGroup}>
                  <Rows3 className="size-3.5" /> <span className="flex-1">Group</span>
                  {grouped && <span className="text-[12px] text-a-faint">On</span>}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCalcSub(true); }}>
                  <Sigma className="size-3.5" /> <span className="flex-1">Calculate</span>
                  {calcLabel !== 'None' && <span className="text-[12px] text-a-faint">{calcLabel}</span>}
                  <ChevronRight className="size-3.5 text-a-faint" />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onFreeze}>
                  <Pin className="size-3.5" /> <span className="flex-1">Freeze</span>
                  {frozen && <Check className="size-3.5" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onHide}>
                  <EyeOff className="size-3.5" /> Hide
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onWrap}>
                  <WrapText className="size-3.5" /> <span className="flex-1">Wrap content</span>
                  {wrapped && <Check className="size-3.5" />}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onInsertLeft}>
                  <ArrowLeftToLine className="size-3.5" /> Insert left
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onInsertRight}>
                  <ArrowRightToLine className="size-3.5" /> Insert right
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="size-3.5" /> Duplicate property
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {confirm ? (
                  <DropdownMenuItem variant="destructive" onClick={onDelete}>
                    <Trash2 className="size-3.5" /> Delete from every record
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={(e) => { e.preventDefault(); setConfirm(true); }}>
                    <Trash2 className="size-3.5" /> Delete property…
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </th>
  );
}

/** The Title column's own header — click to rename it, same as any field. */
function TitleHeaderCell({ label, onCommit }: { label: string; onCommit: (label: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  useEffect(() => { setDraft(label); }, [label]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === label) { setDraft(label); return; }
    onCommit(trimmed);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        maxLength={100}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(label); setEditing(false); }
        }}
        aria-label="Rename the Title column"
        className="w-full rounded-[6px] border-0 bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)] px-1 text-[13px] font-semibold text-a-ink outline-none focus-visible:ring-1 focus-visible:ring-a-accent"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Rename the ${label} column`}
      className="flex items-center gap-1.5 rounded-[6px] px-1 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]"
    >
      <AlignLeft className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

function TitleCell({ title, onCommit }: { title: string; onCommit: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(title); }, [title]);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [editing, draft]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) { setDraft(title); return; }
    onCommit(trimmed);
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        autoFocus
        value={draft}
        maxLength={255}
        rows={1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(title); setEditing(false); }
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
      aria-label={`Edit title of ${title}`}
      // Not flex-1: a flex-1 button stretches to the column's full width even
      // for a short title, pushing RecordMenu's "…" far past the text instead
      // of right after it.
      className={cn(CONTROL, 'w-auto min-w-0 max-w-full py-1.5 font-medium leading-snug')}
    >
      <span className="line-clamp-3 whitespace-pre-wrap">{title}</span>
    </button>
  );
}

function RecordMenu({ title, onDelete }: { title: string; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setConfirm(false); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
          aria-label={`Options for ${title}`}
        >
          <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {confirm ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" /> Delete for good
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={(e) => { e.preventDefault(); setConfirm(true); }}>
            <Trash2 className="size-3.5" /> Delete record…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewRecordRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState('');

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onAdd(trimmed);
    setTitle('');
  };

  return (
    <div className="flex items-center gap-1.5 text-a-faint">
      <Plus className="size-3.5 flex-shrink-0" strokeWidth={1.75} aria-hidden />
      <input
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setTitle('');
        }}
        placeholder="New record"
        aria-label="New record"
        className="h-8 w-full max-w-[320px] rounded-[8px] bg-transparent px-1 text-[14px] text-a-ink outline-none placeholder:text-a-faint/70 focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]"
      />
    </div>
  );
}

interface FieldCellProps {
  def: FieldDef;
  value: FieldValue | undefined;
  recordId: string;
  recordName: string;
  onChange: (value: FieldValue | null) => void;
  linking?: DatabaseTaskLinking;
}

/**
 * The editor for a `longtext` cell: a textarea that wraps and grows to fit what
 * you type, so a paragraph reads as a paragraph instead of scrolling sideways
 * off the column.
 *
 * Height is driven off scrollHeight rather than a fixed row count, and the
 * column's own "Wrap content" toggle is independent — this kind always wraps,
 * because a text area that truncates would be the bug it exists to fix.
 *
 * Commits on blur, like every other cell. Enter inserts a newline (that is the
 * point); Escape reverts and leaves.
 */
function TextAreaCell({ value, ariaLabel, onCommit }: {
  value: string;
  ariaLabel: string;
  onCommit: (draft: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, []);
  useEffect(resize, [draft, resize]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
      className="w-full resize-none bg-transparent py-1.5 text-[14px] leading-[1.5] text-a-ink outline-none placeholder:text-a-faint"
      placeholder="Empty"
    />
  );
}

function FieldCell({ def, value, recordId, recordName, onChange, linking }: FieldCellProps) {
  const label = `${def.name} of ${recordName}`;
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

    // A wrapping, self-sizing box. `text` is a single line that scrolls
    // sideways once it overflows, which makes a paragraph unreadable and
    // uneditable; this is the same stored string with an editor that grows.
    case 'longtext':
      return (
        <TextAreaCell
          value={value === undefined ? '' : String(value)}
          ariaLabel={label}
          onCommit={(draft) => onChange(draft === '' ? null : draft)}
        />
      );

    case 'text':
      return (
        <TextFieldCell
          recordId={recordId}
          fieldId={def.id}
          value={value === undefined ? undefined : String(value)}
          ariaLabel={label}
          onChange={onChange}
          linking={linking}
          className={CONTROL_ROW}
        />
      );

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
            if (raw !== value) onChange(raw);
            return raw;
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
              {chosen.length === 0 && <span className="text-a-faint/60">Empty</span>}
              {chosen.map((o) => (
                <span key={o.id} className={cn('rounded-[3px] px-2 py-0.5 text-[12px] font-medium', OPTION_CHIP_CLASS[o.color])}>
                  {o.label}
                </span>
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

interface CellInputProps {
  value: string;
  type: 'text' | 'number' | 'date';
  ariaLabel: string;
  onCommit: (draft: string) => string;
}

function CellInput({ value, type, ariaLabel, onCommit }: CellInputProps) {
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
      className={cn(CONTROL_ROW, 'placeholder:text-a-faint/60')}
    />
  );
}
