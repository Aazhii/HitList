/**
 * The filter popover's contents — showcase 1059–1074: "Filter and sort" with an active
 * count, a three-column grid of labelled selects (Status, Quadrant, Category, Due, Sort
 * by, Group by — then one per custom field), Show completed / Clear done, and "Save as a
 * view". The popover itself (anchor, width) stays in the page header.
 */
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { topBarPill, topBarPrimary } from '@/components/shell/TopBar';
import {
  DEFAULT_FILTERS, FIELD_EMPTY, FIELD_SET, countNarrowingFilters, fieldSortKey, isGroupableField, type FilterState,
} from '@/lib/taskFilters';
import { CATEGORIES } from '@/types/todo';
import type { TaskLayout } from '@/lib/api';
import type { FieldDef } from '@/types/fields';

const ANY = '__any__';

interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  fieldDefs: FieldDef[];
  /** Grouping by a field applies to the list, the table and the board, not the matrix. */
  layout: TaskLayout;
  showDone: boolean;
  onShowDoneChange: (show: boolean) => void;
  doneCount: number;
  onClearDone: () => void;
  listName: string;
  onSaveView: (name: string, scopeToList: boolean) => Promise<boolean>;
}

const LABEL = 'text-[13px] font-medium leading-[1.35] text-a-ink';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

function Pick({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function FilterPanel({
  filters, onChange, fieldDefs, layout, showDone, onShowDoneChange, doneCount, onClearDone, listName, onSaveView,
}: FilterPanelProps) {
  const [viewName, setViewName] = useState('');
  const [scoped, setScoped] = useState(true);
  const [saving, setSaving] = useState(false);

  const active = countNarrowingFilters(filters);
  const set = (key: keyof FilterState, value: string) => onChange({ ...filters, [key]: value });
  const fromAny = (v: string) => (v === ANY ? '' : v);
  const groupFields = fieldDefs.filter(isGroupableField);

  const submit = async () => {
    const name = viewName.trim();
    if (!name || saving) return;
    setSaving(true);
    const ok = await onSaveView(name, scoped);
    setSaving(false);
    if (ok) setViewName('');
  };

  const setFieldChoice = (fieldId: string, choice: string) => {
    const next = { ...filters.fields };
    if (choice === ANY) delete next[fieldId]; else next[fieldId] = [choice];
    onChange({ ...filters, fields: next });
  };

  return (
    <div className="flex flex-col gap-3.5 text-[13px] leading-normal text-a-muted">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-a-ink">Filter and sort</span>
        {active > 0 && (
          // design-check-ignore: pill — the DS Badge is a pill (showcase 1062).
          <span className="rounded-full border border-transparent bg-a-blue-tint px-2 py-[3px] text-[11px] leading-none font-semibold text-a-accent-700">
            {active} active
          </span>
        )}
        <div className="flex-1" />
        <button type="button" className={topBarPill} onClick={() => onChange(DEFAULT_FILTERS)}>Clear all</button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Pick
          label="Status" value={filters.status || ANY} onChange={(v) => set('status', fromAny(v))}
          options={[{ value: ANY, label: 'Any' }, { value: 'TODO', label: 'To do' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'DONE', label: 'Done' }]}
        />
        <Pick
          label="Quadrant" value={filters.quadrant || ANY} onChange={(v) => set('quadrant', fromAny(v))}
          options={[{ value: ANY, label: 'Any' }, { value: 'DO', label: 'Do first' }, { value: 'SCHEDULE', label: 'Schedule' }, { value: 'DELEGATE', label: 'Delegate' }, { value: 'ELIMINATE', label: 'Eliminate' }]}
        />
        <Pick
          label="Category" value={filters.category || ANY} onChange={(v) => set('category', fromAny(v))}
          options={[{ value: ANY, label: 'Any' }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]}
        />
        <Pick
          label="Due" value={filters.due || ANY} onChange={(v) => set('due', fromAny(v))}
          options={[{ value: ANY, label: 'Any' }, { value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Due today' }, { value: 'next7', label: 'Next 7 days' }, { value: 'none', label: 'No due date' }]}
        />
        <Pick
          label="Sort by" value={filters.sortBy ?? 'order'} onChange={(v) => set('sortBy', v)}
          options={[
            { value: 'order', label: 'Manual order' }, { value: 'created', label: 'Date added' }, { value: 'due-date', label: 'Due date' },
            { value: 'status', label: 'Status' }, { value: 'title', label: 'Title' }, { value: 'quadrant', label: 'Quadrant' },
            ...fieldDefs.map((d) => ({ value: fieldSortKey(d.id), label: d.name })),
          ]}
        />
        {layout !== 'matrix' && layout !== 'calendar' && groupFields.length > 0 && (
          <Pick
            label="Group by" value={filters.groupBy || ANY} onChange={(v) => set('groupBy', fromAny(v))}
            options={[
              { value: ANY, label: layout === 'board' ? 'Choose a field' : 'None' },
              ...groupFields.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        )}
        {fieldDefs.map((def) => (
          <Pick
            key={def.id}
            label={def.name}
            value={filters.fields[def.id]?.[0] ?? ANY}
            onChange={(v) => setFieldChoice(def.id, v)}
            options={[
              { value: ANY, label: 'Any' },
              ...((def.kind === 'select' || def.kind === 'multi') ? def.options.map((o) => ({ value: o.id, label: o.label })) : []),
              { value: FIELD_SET, label: def.kind === 'checkbox' ? 'Checked' : 'Has a value' },
              { value: FIELD_EMPTY, label: def.kind === 'checkbox' ? 'Unchecked' : 'Empty' },
            ]}
          />
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-a-line-soft pt-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-a-ink">
          <Switch size="sm" checked={showDone} onCheckedChange={onShowDoneChange} />
          Show completed
        </label>
        {doneCount > 0 && (
          <button type="button" className={topBarPill} onClick={onClearDone}>Clear done ({doneCount})</button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-a-line-soft pt-3">
        <span className="font-semibold text-a-ink">Save as a view</span>
        <div className="flex items-end gap-2">
          <Input
            className={cn('h-7 flex-1 px-2')}
            value={viewName}
            maxLength={100}
            placeholder="e.g. Health this week"
            aria-label="View name"
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
          <button type="button" className={topBarPrimary} aria-disabled={!viewName.trim() || saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : 'Save view'}
          </button>
        </div>
        <Checkbox label={`Only show in ${listName}`} checked={scoped} onChange={(e) => setScoped(e.target.checked)} />
      </div>
    </div>
  );
}

