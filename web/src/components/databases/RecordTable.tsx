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
  AlignLeft, ArrowDown, File, ArrowLeftToLine, ArrowRightToLine, ArrowUp, Calendar, Check, ChevronDown,
  ChevronRight, CircleChevronDown, Copy, Eraser, EyeOff, Hash, List, MoreHorizontal, Pencil,
  Pin, Plus, Repeat2, Rows3, Sigma, SquareCheck, Text as TextIcon, Trash2, Type, WrapText, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { topBarPill } from '@/components/shell/TopBar';
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
import { ColumnMenu } from '@/components/databases/ColumnMenu';
import { OPTION_CHIP_CLASS, selectedOptions } from '@/lib/fieldValues';
import type { ApiDatabaseRow } from '@/lib/api';
import { FIELD_KIND_LABELS, type FieldDef, type FieldKind, type FieldValue } from '@/types/fields';
import type { DatabaseTaskLinking } from '@/pages/DatabasesPage';

/** Every kind offered from "Change type" — same six as field creation, in the same order. */
export const CHANGE_TYPE_KINDS: readonly FieldKind[] = ['text', 'longtext', 'number', 'select', 'multi', 'date', 'checkbox'];

/** The showcase's literal per-type icon (`TYPES` array, `HitList Notion x Zoho.dc.html` line 1389). */
export const KIND_ICON: Record<FieldDef['kind'], typeof AlignLeft> = {
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
  const raw = rows.map((r) => (field.id === TITLE_ID ? r.title : values[r.id]?.[field.id]));
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
  /** Rename a column, from its menu. */
  onRenameField: (fieldId: string, name: string) => void;
  onChangeFieldOptions: (fieldId: string, options: FieldDef['options']) => void;
  /** "Filter" in a column menu: open the filter with this column chosen. */
  onFilterField: (fieldId: string) => void;
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
  /** The page icon's Open button: show this record in the peek panel. */
  onOpenRecord: (recordId: string) => void;
  /** Show the little page icon in the Title cell. */
  showPageIcon: boolean;
  onTogglePageIcon: () => void;
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

/** The Title column is not a field, but its menu, sort, group, calc, freeze and wrap speak in ids like one. */
export const TITLE_ID = 'title';
/** The table sits this far in from the scroll container's edge (16px, 48px from md): a pinned column's `left` starts there. */
const INSET_VARS = '[--tbl-inset:1rem] md:[--tbl-inset:3rem]';

/** Column sizing. The design gives every column an explicit width (showcase 619, 1539–1550). */
const TITLE_COL_WIDTH = 260;
const MIN_COL_WIDTH = 72;
/** The showcase's widths per column type: status 140, multi 190, number 90, date 130, checkbox 80, url 170. */
const KIND_COL_WIDTH: Record<FieldDef['kind'], number> = {
  select: 140, multi: 190, number: 90, date: 130, checkbox: 80, text: 170, longtext: 260,
};
const colWidthOf = (field: FieldDef, widths: Record<string, number>) => widths[field.id] ?? KIND_COL_WIDTH[field.kind];
// The cell already pads 8px; the prototype's content sits at that edge (showcase 634–640).
const CONTROL = cn(
  'w-full rounded-[4px] border-0 bg-transparent px-0 text-left text-[14px] text-a-ink',
  'transition-colors duration-[120ms] hover:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]',
  'focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a-accent',
);
const CONTROL_ROW = cn(CONTROL, 'h-6');

export function RecordTable({
  rows, fields, titleLabel, onRenameTitleLabel, values, loading,
  onAdd, onRename, onDelete, onSetValue, onRenameField, onChangeFieldOptions, onFilterField, onDeleteField, onCreateField, onReorderFields, linking,
  sort, onSortField, onClearSort, groupFieldId, onGroupField, calc, onCalcField,
  frozenFieldId, onFreezeField, onOpenRecord, showPageIcon, onTogglePageIcon, wrapFieldIds, onWrapField, colWidths, onResizeField, onHideField, onInsertField, onDuplicateField, onChangeFieldKind,
}: RecordTableProps) {
  const columnCount = 2 + fields.length;
  /** How many records hold this option, for the remove guard in Edit options. */
  const optionUsageFor = (fieldId: string, optionId: string) => rows.filter((r) => {
    const v = values[r.id]?.[fieldId];
    return v === optionId || (Array.isArray(v) && v.includes(optionId));
  }).length;
  const tableWidth = TITLE_COL_WIDTH + fields.reduce((n, f) => n + colWidthOf(f, colWidths), 0) + 44;
  const hasCalc = Object.keys(calc).length > 0;
  const titleField: FieldDef = {
    id: TITLE_ID, name: titleLabel, kind: 'text', options: [], fieldOrder: -1, showOnCard: false, createdAt: 0, updatedAt: 0,
  };
  const groupField = groupFieldId === TITLE_ID ? titleField : fields.find((f) => f.id === groupFieldId) ?? null;
  // Freezing a column pins Title and every column up to and including it (showcase, db-freeze);
  // freezing Title pins just Title. Each pinned column sticks at the table's inset plus the
  // widths before it, on a solid background.
  const frozenIndex = frozenFieldId === TITLE_ID ? -1 : fields.findIndex((f) => f.id === frozenFieldId);
  const titlePinned = frozenFieldId !== null && (frozenFieldId === TITLE_ID || frozenIndex >= 0);
  const pinnedLeft = (index: number): string | undefined => {
    if (!titlePinned || index > frozenIndex) return undefined;
    const before = fields.slice(0, index).reduce((n, f) => n + colWidthOf(f, colWidths), 0);
    return `calc(var(--tbl-inset) + ${TITLE_COL_WIDTH + before}px)`;
  };
  const titleLeft = titlePinned ? 'var(--tbl-inset)' : undefined;

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
      <td
        style={{ left: titleLeft }}
        className={cn(
          CELL, 'relative w-[260px] min-w-[260px] border-r border-a-line-soft',
          titlePinned && 'sticky z-[1] bg-a-surface group-hover:bg-a-row-alt',
        )}
      >
        <div className="flex items-start gap-1">
          <TitleCell
            showIcon={showPageIcon}
            onOpen={() => onOpenRecord(row.id)}
            wrap={wrapFieldIds.includes(TITLE_ID)}
            title={row.title}
            onCommit={(title) => { if (title && title !== row.title) onRename(row.id, title); }}
          />
          <RecordMenu title={row.title} onDelete={() => onDelete(row.id)} />
        </div>
      </td>

      {fields.map((field, i) => (
        <td
          key={field.id}
          style={{ width: colWidthOf(field, colWidths), left: pinnedLeft(i) }}
          className={cn(
            CELL, 'border-r border-a-line-soft',
            pinnedLeft(i) && 'sticky z-[1] bg-a-surface group-hover:bg-a-row-alt',
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
    <div className="animate-fade-in">
    {/* Full-bleed (showcase 614): the grid runs edge to edge under a hairline, its first
        column starting where the page content does. */}
    <div className="-mx-4 overflow-x-auto border-t border-a-line md:-mx-12">
    <div className={cn('w-max px-4 md:px-12', INSET_VARS)}>
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
        <table className="border-collapse text-[14px]" style={{ tableLayout: 'fixed', width: tableWidth }}>
          <colgroup>
            <col style={{ width: TITLE_COL_WIDTH }} />
            {fields.map((f) => <col key={f.id} style={{ width: colWidthOf(f, colWidths) }} />)}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr className="h-9 border-b border-a-line bg-a-bg">
              <th
                scope="col"
                style={{ left: titleLeft }}
                className={cn(
                  'relative h-9 w-[260px] min-w-[260px] border-r border-a-line-soft px-2 text-left align-middle font-normal',
                  titlePinned && 'sticky z-[2] bg-a-bg',
                )}
              >
                <TitleHeaderCell
                  field={titleField}
                  sortDir={sort?.fieldId === TITLE_ID ? sort.dir : null}
                  grouped={groupFieldId === TITLE_ID}
                  calc={calc[TITLE_ID] ?? ''}
                  frozen={frozenFieldId === TITLE_ID}
                  wrapped={wrapFieldIds.includes(TITLE_ID)}
                  showPageIcon={showPageIcon}
                  onTogglePageIcon={onTogglePageIcon}
                  onRename={onRenameTitleLabel}
                  onFilter={() => onFilterField(TITLE_ID)}
                  onSort={(dir) => onSortField(TITLE_ID, dir)}
                  onGroup={() => onGroupField(TITLE_ID)}
                  onCalc={(key) => onCalcField(TITLE_ID, key)}
                  onFreeze={() => onFreezeField(TITLE_ID)}
                  onWrap={() => onWrapField(TITLE_ID)}
                  onInsertLeft={() => onInsertField(TITLE_ID, 'left')}
                  onInsertRight={() => onInsertField(TITLE_ID, 'right')}
                />
                {/* Every record has a title, so this bar is always full. */}
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-a-dq-missing">
                  <span className="block h-full bg-a-dq-valid" style={{ width: rows.length ? '100%' : '0%' }} />
                </span>
              </th>
              <SortableContext items={fields.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
                {fields.map((field, i) => (
                  <FieldHeader
                    key={field.id}
                    pinnedLeft={pinnedLeft(i)}
                    field={field}
                    filled={fillCount(field, rows, values)}
                    total={rows.length}
                    sortDir={sort?.fieldId === field.id ? sort.dir : null}
                    grouped={groupFieldId === field.id}
                    calc={calc[field.id] ?? ''}
                    frozen={frozenFieldId === field.id}
                    wrapped={wrapFieldIds.includes(field.id)}
                    width={colWidthOf(field, colWidths)}
                    onResize={(w) => onResizeField(field.id, w)}
                    optionUsage={(optionId) => optionUsageFor(field.id, optionId)}
                    onRename={(name) => onRenameField(field.id, name)}
                    onChangeOptions={(options) => onChangeFieldOptions(field.id, options)}
                    onFilter={() => onFilterField(field.id)}
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
                  className="flex size-7 items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink"
                  aria-label="Add a property"
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
                  const label = groupField.id === TITLE_ID ? row.title : groupLabelFor(groupField, values[row.id]?.[groupField.id]);
                  (groups.get(label) ?? groups.set(label, []).get(label)!).push(row);
                  return groups;
                }, new Map<string, ApiDatabaseRow[]>()),
              ).map(([label, groupRows]) => (
                <Fragment key={`group-${label}`}>
                  {/* Showcase group row: the option's own tag (22px, 3px radius, no dot), then a
                      tertiary count outside it. */}
                  <tr className="h-9 border-b border-a-line-soft">
                    <td colSpan={columnCount} className="p-0 pl-1">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex h-[22px] items-center rounded-[3px] px-2 text-[13px] leading-none whitespace-nowrap',
                            (() => {
                              const color = groupField.options.find((o) => o.label === label)?.color;
                              return color ? OPTION_CHIP_CLASS[color] : 'bg-a-line-soft text-a-ink';
                            })(),
                          )}
                        >
                          {label}
                        </span>
                        <span className="text-[13px] text-a-faint">{groupRows.length}</span>
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
                <td
                  style={{ left: titleLeft }}
                  className={cn('px-2 text-right text-[12px] text-a-faint', titlePinned && 'sticky z-[1] bg-a-surface')}
                >
                  {calcText(calc[TITLE_ID] ?? '', titleField, rows, values)}
                </td>
                {fields.map((field, i) => (
                  <td
                    key={field.id}
                    style={{ left: pinnedLeft(i) }}
                    className={cn(
                      'px-2 text-right text-[12px] text-a-faint',
                      pinnedLeft(i) && 'sticky z-[1] bg-a-surface',
                    )}
                  >
                    {calcText(calc[field.id] ?? '', field, rows, values)}
                  </td>
                ))}
                <td aria-hidden />
              </tr>
            )}

            <tr className="border-b border-a-line-soft">
              <td colSpan={columnCount} className="p-0">
                <NewRecordRow onAdd={onAdd} />
              </td>
            </tr>
          </tbody>
        </table>
      </DndContext>
    </div>
    </div>

      {rows.length > 0 && (
        <p className="py-1.5 text-[12px] text-a-faint">{`${rows.length} record${rows.length === 1 ? '' : 's'}`}</p>
      )}

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
  /** CSS `left` when this column is pinned by a freeze at or after it. */
  pinnedLeft?: string;
  wrapped: boolean;
  width: number;
  onResize: (width: number) => void;
  optionUsage: (optionId: string) => number;
  onRename: (name: string) => void;
  onChangeOptions: (options: FieldDef['options']) => void;
  onFilter: () => void;
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
  field, filled, total, sortDir, grouped, calc, frozen, pinnedLeft, wrapped, width, onResize,
  optionUsage, onRename, onChangeOptions, onFilter, onDelete, onSort, onClearSort, onGroup, onCalc, onFreeze, onHide, onWrap, onInsertLeft, onInsertRight, onDuplicate, onChangeKind,
}: FieldHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const lastDragEnd = useRef(0);
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: field.id });
  // A drag ends with a click on the name; that must not read as "open the menu".
  const wasDragging = useRef(false);
  useEffect(() => {
    if (wasDragging.current && !isDragging) lastDragEnd.current = Date.now();
    wasDragging.current = isDragging;
  }, [isDragging]);
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100);

  const Icon = KIND_ICON[field.kind];

  return (
    <th
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, width, left: pinnedLeft }}
      scope="col"
      title={`${filled} of ${total} filled`}
      className={cn(
        'group/head relative h-9 border-r border-a-line-soft px-2 text-left align-middle font-normal',
        isDragging && 'z-10 bg-a-bg shadow-[var(--a-shadow-md)]',
        pinnedLeft && 'sticky z-[2] bg-a-bg',
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
          onClick={() => { if (Date.now() - lastDragEnd.current > 250) setMenuOpen(true); }}
          className="relative z-[1] cursor-grab touch-none text-[13px] font-semibold whitespace-nowrap text-a-ink select-none active:cursor-grabbing"
        >
          {field.name}
        </span>
        {frozen && <Pin className="size-3 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />}
        {sortDir && (sortDir === 1 ? <ArrowUp className="size-3.5 flex-shrink-0 text-a-accent" strokeWidth={1.75} /> : <ArrowDown className="size-3.5 flex-shrink-0 text-a-accent" strokeWidth={1.75} />)}
        <ColumnMenu
          field={field}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          kindIcon={KIND_ICON}
          kinds={CHANGE_TYPE_KINDS}
          calcOptions={CALC_OPTIONS}
          calc={calc}
          sortDir={sortDir}
          grouped={grouped}
          frozen={frozen}
          wrapped={wrapped}
          optionUsage={optionUsage}
          onRename={onRename}
          onChangeKind={onChangeKind}
          onChangeOptions={onChangeOptions}
          onFilter={onFilter}
          onSort={onSort}
          onGroup={onGroup}
          onCalc={onCalc}
          onFreeze={onFreeze}
          onHide={onHide}
          onWrap={onWrap}
          onInsertLeft={onInsertLeft}
          onInsertRight={onInsertRight}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          // A cover over the whole header: clicking it opens the menu, and the menu hangs from
          // the header's left edge (showcase 618). The name and resize handle sit above it.
          trigger={<button type="button" aria-label={`${field.name} column options`} className="absolute inset-0 z-0 cursor-pointer" />}
        />
      </span>
    </th>
  );
}

/** The Title column's header: the same click-to-open menu as a field, minus what a title cannot do. */
function TitleHeaderCell(p: {
  field: FieldDef; sortDir: 1 | -1 | null; grouped: boolean; calc: string; frozen: boolean; wrapped: boolean;
  showPageIcon: boolean; onTogglePageIcon: () => void;
  onRename: (name: string) => void; onFilter: () => void; onSort: (dir: 1 | -1) => void; onGroup: () => void;
  onCalc: (key: string) => void; onFreeze: () => void; onWrap: () => void; onInsertLeft: () => void; onInsertRight: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const noop = () => {};
  return (
    <span className="flex items-center gap-1.5">
      <Type className="size-[15px] flex-shrink-0 text-a-ink" strokeWidth={1.75} aria-hidden />
      <span className="relative z-[1] cursor-pointer text-[13px] font-semibold whitespace-nowrap text-a-ink select-none" onClick={() => setMenuOpen(true)}>
        {p.field.name}
      </span>
      {p.frozen && <Pin className="size-3 flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />}
      {p.sortDir && (p.sortDir === 1 ? <ArrowUp className="size-3.5 flex-shrink-0 text-a-accent" strokeWidth={1.75} /> : <ArrowDown className="size-3.5 flex-shrink-0 text-a-accent" strokeWidth={1.75} />)}
      <ColumnMenu
        variant="title"
        field={p.field}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        kindIcon={KIND_ICON}
        kinds={CHANGE_TYPE_KINDS}
        calcOptions={CALC_OPTIONS}
        calc={p.calc}
        sortDir={p.sortDir}
        grouped={p.grouped}
        frozen={p.frozen}
        wrapped={p.wrapped}
        showPageIcon={p.showPageIcon}
        onTogglePageIcon={p.onTogglePageIcon}
        optionUsage={() => 0}
        onRename={p.onRename}
        onChangeKind={noop}
        onChangeOptions={noop}
        onFilter={p.onFilter}
        onSort={p.onSort}
        onGroup={p.onGroup}
        onCalc={p.onCalc}
        onFreeze={p.onFreeze}
        onHide={noop}
        onWrap={p.onWrap}
        onInsertLeft={p.onInsertLeft}
        onInsertRight={p.onInsertRight}
        onDuplicate={noop}
        onDelete={noop}
        trigger={<button type="button" aria-label={`${p.field.name} column options`} className="absolute inset-0 z-0 cursor-pointer" />}
      />
    </span>
  );
}

function TitleCell({ title, onCommit, showIcon, wrap, onOpen }: { title: string; onCommit: (title: string) => void; showIcon: boolean; wrap: boolean; onOpen: () => void }) {
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
        className={cn(CONTROL, 'min-w-0 flex-1 resize-none py-0 leading-6', showIcon && 'pl-[22px]')}
      />
    );
  }

  return (
    // The page glyph (a button: it opens the record's peek) then the title on one line
    // (showcase 634); the full title is its tooltip.
    <div className={cn('flex min-h-6 min-w-0 flex-1 gap-1.5', wrap ? 'items-start' : 'items-center')}>
      {showIcon && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${title}`}
          title="Open"
          className={'-m-0.5 flex size-5 flex-shrink-0 items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink'}
        >
          <File className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit title of ${title}`}
        title={title}
        className={cn('flex min-h-6 min-w-0 flex-1 rounded-[4px] text-left text-[14px] text-a-ink', wrap ? 'items-start py-[2px]' : 'h-6 items-center')}
      >
        <span className={wrap ? 'break-words' : 'truncate'}>{title}</span>
      </button>
    </div>
  );
}

function RecordMenu({ title, onDelete }: { title: string; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setConfirm(false); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute top-1.5 right-1 flex size-6 items-center justify-center rounded-[4px] bg-a-surface text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-a-line-soft hover:text-a-ink"
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

/** The last row (showcase 641): a full-width ghost "New record"; click it and type a title. */
function NewRecordRow({ onAdd }: { onAdd: (title: string) => void }) {
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
        className="flex h-9 w-full items-center gap-2 px-3.5 text-left text-[14px] text-a-faint transition-colors duration-[120ms] hover:bg-a-bg"
      >
        <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
        New record
      </button>
    );
  }

  return (
    <div className="flex h-9 items-center gap-2 px-3.5 text-a-faint">
      <Plus className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
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
        placeholder="Title"
        aria-label="New record"
        className="h-7 w-full max-w-[320px] rounded-[4px] bg-transparent px-1 text-[14px] text-a-ink outline-none placeholder:text-a-faint focus-visible:bg-a-line-soft"
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
  /** In the record peek a date reads in the body font; the table sets it in mono. */
  peek?: boolean;
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
      placeholder=""
    />
  );
}

export function FieldCell({ def, value, recordId, recordName, onChange, linking, peek }: FieldCellProps) {
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
              'flex size-4 items-center justify-center rounded-[3px] border-[1.5px] transition-colors duration-[120ms]',
              on ? 'border-a-accent bg-a-accent text-white' : 'border-a-line-strong bg-a-surface',
            )}
            aria-hidden
          >
            {on && (
              <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
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

    case 'date':
      return <DateCell value={typeof value === 'string' ? value : ''} ariaLabel={label} onChange={onChange} plain={peek} />;

    case 'number':
      return (
        <CellInput
          type="number"
          value={value === undefined ? '' : String(value)}
          ariaLabel={label}
          className={peek ? undefined : 'font-mono text-[13px] tabular-nums'}
          onCommit={(draft) => {
            const raw = draft.trim();
            if (raw === '') { if (value !== undefined) onChange(null); return ''; }
            const n = Number(raw);
            if (!Number.isFinite(n)) return value === undefined ? '' : String(value);
            if (n !== value) onChange(n);
            return String(n);
          }}
        />
      );

    case 'select':
    case 'multi': {
      const chosen = selectedOptions(def, value);
      return (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(CONTROL, 'flex min-h-6 flex-wrap items-center gap-1.5 py-0')} aria-label={label}>
              
              {chosen.map((o) => (
                // Showcase 1500s: a 22px tag, 3px radius, 13px; a single select carries a dot.
                <span key={o.id} className={cn('inline-flex h-[22px] items-center gap-1.5 rounded-[3px] px-2 text-[13px] leading-none whitespace-nowrap', OPTION_CHIP_CLASS[o.color])}>
                  {def.kind === 'select' && !peek && <span className="size-2 rounded-full bg-current opacity-70" aria-hidden />}
                  {o.label}
                </span>
              ))}
            </button>
          </PopoverTrigger>
          {/* Showcase 739–748: a listbox — a caption, each option as its tag with a tick on the chosen
              ones, and "Clear value". A single select closes on choosing; a multi stays open. */}
          <PopoverContent role="listbox" aria-label="Options" align="start" className="w-60 gap-0 p-1.5 text-[14px]">
            <div className="px-2 py-1 text-[12px] text-a-faint">{def.kind === 'multi' ? 'Select options' : 'Select an option'}</div>
            {def.options.map((o) => {
              const on = chosen.some((c) => c.id === o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    if (def.kind === 'multi') {
                      const ids = chosen.map((c) => c.id);
                      const next = on ? ids.filter((id) => id !== o.id) : [...ids, o.id];
                      onChange(next.length ? next : null);
                    } else {
                      onChange(o.id);
                      setPopoverOpen(false);
                    }
                  }}
                  className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[4px] px-2 py-[5px] text-left leading-[normal] transition-colors duration-[120ms] hover:bg-a-line-soft"
                >
                  <span className={cn('inline-flex h-[22px] items-center rounded-[3px] px-2 text-[13px] leading-none', OPTION_CHIP_CLASS[o.color])}>{o.label}</span>
                  <span className="flex-1" />
                  {on && <Check className="size-[15px] text-a-accent" strokeWidth={1.75} aria-hidden />}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => { onChange(null); setPopoverOpen(false); }}
              className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[4px] px-2 py-[5px] text-left leading-[normal] text-a-faint transition-colors duration-[120ms] hover:bg-a-line-soft"
            >
              <Eraser className="size-[15px]" strokeWidth={1.75} aria-hidden />
              Clear value
            </button>
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
  className?: string;
  onCommit: (draft: string) => string;
}

/** "Aug 14, 2026" — a date cell reads as words (showcase `fmtDate`), in the tabular mono face. */
function formatCellDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A date shows as text; clicking it opens a date input in a popover. */
function DateCell({ value, ariaLabel, onChange, plain }: { value: string; ariaLabel: string; onChange: (value: FieldValue | null) => void; plain?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} className={cn(CONTROL_ROW, 'flex items-center', !plain && 'font-mono text-[13px] tabular-nums')}>
          {value ? formatCellDate(value) : ''}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value || null)}
            aria-label={`${ariaLabel} (date)`}
            className="h-7 rounded-[3px] border border-a-line-strong bg-a-surface px-2 text-[13px] text-a-ink outline-none focus-visible:border-a-accent"
          />
          {value && (
            <button type="button" className={topBarPill} onClick={() => { onChange(null); setOpen(false); }}>Clear</button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CellInput({ value, type, ariaLabel, className, onCommit }: CellInputProps) {
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
      aria-label={ariaLabel}
      className={cn(CONTROL_ROW, className)}
    />
  );
}
