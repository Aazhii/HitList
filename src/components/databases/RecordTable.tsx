/**
 * A database's records as a table: Title, then a column per field.
 *
 * The same shape as the tasks table, minus what only a task has — no status,
 * quadrant or due date, and no reminders. Titles wrap and edit in place, every
 * field cell edits in place, and a column header carries the field's own menu,
 * so a column is changed from where it is used.
 *
 * Deliberately not a copy of TaskTableView: that one is built on Todo, with
 * built-in task columns and drag ordering. Sharing it would mean threading
 * "which built-in columns exist" through every row, for two screens that differ
 * in more than they share. The cells that do the real work — the field editors —
 * are shared.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { OPTION_CHIP_CLASS, selectedOptions } from '@/lib/fieldValues';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef, FieldValue } from '@/types/fields';

export interface RecordTableProps {
  rows: ApiDatabaseRow[];
  fields: FieldDef[];
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
}

const CELL = 'px-2 py-1 align-top';
const CONTROL = cn(
  'w-full rounded-[9px] border-0 bg-transparent px-2 text-left text-[13.5px] text-a-ink',
  'transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]',
  'focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a-accent',
);
const CONTROL_ROW = cn(CONTROL, 'h-8');

export function RecordTable({
  rows, fields, values, loading,
  onAdd, onRename, onDelete, onSetValue, onEditField, onDeleteField, onCreateField,
}: RecordTableProps) {
  const columnCount = 2 + fields.length;

  return (
    <div className="w-full overflow-x-auto animate-fade-in">
      <table className="w-full min-w-max border-collapse text-[13.5px]">
        <thead>
          <tr className="border-b border-a-line-soft">
            <th scope="col" className="sticky left-0 z-10 min-w-[280px] bg-a-bg px-2 py-2 text-left align-bottom font-normal">
              <span className="px-2 py-1 text-[12.5px] font-semibold text-a-faint">Title</span>
            </th>
            {fields.map((field) => (
              <FieldHeader
                key={field.id}
                field={field}
                onEdit={() => onEditField(field.id)}
                onDelete={() => onDeleteField(field.id)}
              />
            ))}
            <th scope="col" className="px-2 py-2 text-left align-bottom font-normal">
              <button
                type="button"
                onClick={onCreateField}
                className="flex size-7 items-center justify-center rounded-[7px] text-a-faint transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink"
                aria-label="Add a column"
              >
                <Plus className="size-3.5" strokeWidth={2.75} />
              </button>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group border-b border-a-line-soft/60">
              <td className={cn(CELL, 'sticky left-0 z-10 bg-a-bg')}>
                <div className="flex items-start gap-1">
                  <TitleCell
                    title={row.title}
                    onCommit={(title) => { if (title && title !== row.title) onRename(row.id, title); }}
                  />
                  <RecordMenu title={row.title} onDelete={() => onDelete(row.id)} />
                </div>
              </td>

              {fields.map((field) => (
                <td key={field.id} className={cn(CELL, 'min-w-[150px]')}>
                  <FieldCell
                    def={field}
                    value={values[row.id]?.[field.id]}
                    recordName={row.title}
                    onChange={(value) => onSetValue(row.id, field.id, value)}
                  />
                </td>
              ))}

              <td className={CELL} aria-hidden />
            </tr>
          ))}

          <tr>
            <td colSpan={columnCount} className="px-2 py-0.5">
              <NewRecordRow onAdd={onAdd} />
            </td>
          </tr>
        </tbody>
      </table>

      {rows.length === 0 && !loading && (
        <p className="px-4 py-8 text-center text-[13.5px] text-a-faint">
          No records yet. Add one above, and give it columns with <span className="font-semibold">New column</span>.
        </p>
      )}
    </div>
  );
}

function FieldHeader({ field, onEdit, onDelete }: { field: FieldDef; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);

  return (
    <th scope="col" className="group/head px-2 py-2 text-left align-bottom font-normal">
      <span className="flex items-center gap-0.5">
        <span className="px-2 py-1 text-[12.5px] font-semibold whitespace-nowrap text-a-faint">{field.name}</span>
        <DropdownMenu onOpenChange={(open) => { if (!open) setConfirm(false); }}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-[7px] text-a-faint opacity-0 transition-opacity duration-150 group-hover/head:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
              aria-label={`${field.name} column options`}
            >
              <ChevronDown className="size-3.5" strokeWidth={2.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5" /> Edit column…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {confirm ? (
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="size-3.5" /> Delete from every record
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={(e) => { e.preventDefault(); setConfirm(true); }}>
                <Trash2 className="size-3.5" /> Delete column…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </th>
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
      className={cn(CONTROL, 'min-w-0 flex-1 py-1.5 font-medium leading-snug')}
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
          className="mt-0.5 flex size-7 flex-shrink-0 items-center justify-center rounded-[8px] text-a-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-a-ink"
          aria-label={`Options for ${title}`}
        >
          <MoreHorizontal className="size-3.5" strokeWidth={2.5} />
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
      <Plus className="size-3.5 flex-shrink-0" strokeWidth={2.75} aria-hidden />
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
        className="h-8 w-full max-w-[320px] rounded-[9px] bg-transparent px-1 text-[13.5px] text-a-ink outline-none placeholder:text-a-faint/70 focus-visible:bg-[color-mix(in_srgb,var(--a-ink)_6%,transparent)]"
      />
    </div>
  );
}

interface FieldCellProps {
  def: FieldDef;
  value: FieldValue | undefined;
  recordName: string;
  onChange: (value: FieldValue | null) => void;
}

function FieldCell({ def, value, recordName, onChange }: FieldCellProps) {
  const label = `${def.name} of ${recordName}`;

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
