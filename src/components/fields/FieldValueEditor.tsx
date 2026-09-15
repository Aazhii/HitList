/**
 * The editor for one task's value of one custom field.
 *
 * Select, multi-select, date and checkbox save on change. Number and text
 * save when the input loses focus or on Enter, so typing "120" is one save,
 * not three.
 */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OPTION_CHIP_CLASS, OPTION_DOT_CLASS } from '@/lib/fieldValues';
import type { FieldDef, FieldValue } from '@/types/fields';

interface FieldValueEditorProps {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: FieldValue | null) => void;
  disabled?: boolean;
}

const INPUT = 'h-9 w-full rounded-xl border-0 bg-muted/30 text-xs focus-visible:ring-1 focus-visible:ring-primary/40';

export function FieldValueEditor({ field, value, onChange, disabled }: FieldValueEditorProps) {
  switch (field.kind) {
    case 'select':
      return (
        <Select
          value={typeof value === 'string' ? value : '__none__'}
          onValueChange={(v) => onChange(v === '__none__' ? null : v)}
          disabled={disabled}
        >
          <SelectTrigger className={INPUT} aria-label={field.name}><SelectValue placeholder="Empty" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__"><span className="text-muted-foreground">Empty</span></SelectItem>
            {field.options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                <span className="flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', OPTION_DOT_CLASS[o.color])} aria-hidden />
                  {o.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'multi': {
      const chosen = new Set(Array.isArray(value) ? value : []);
      if (field.options.length === 0) {
        return <p className="text-[11px] text-muted-foreground">This field has no options yet.</p>;
      }
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={field.name}>
          {field.options.map((o) => {
            const on = chosen.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(chosen);
                  if (on) next.delete(o.id); else next.add(o.id);
                  // In the field's option order, so the stored list is stable.
                  const ordered = field.options.map((x) => x.id).filter((id) => next.has(id));
                  onChange(ordered.length ? ordered : null);
                }}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150',
                  on ? OPTION_CHIP_CLASS[o.color] : 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--a-line)] hover:text-foreground',
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case 'checkbox':
      return (
        <label className="flex h-9 cursor-pointer items-center gap-2.5 rounded-xl bg-muted/30 px-3 text-xs">
          <Switch checked={value === true} onCheckedChange={(on) => onChange(on ? true : null)} disabled={disabled} />
          {value === true ? 'Yes' : 'No'}
        </label>
      );

    case 'date':
      return (
        <Input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled}
          className={INPUT}
          aria-label={field.name}
        />
      );

    case 'number':
    case 'text':
      return <CommitOnBlurInput field={field} value={value} onChange={onChange} disabled={disabled} />;
  }
}

function CommitOnBlurInput({ field, value, onChange, disabled }: FieldValueEditorProps) {
  const initial = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  useEffect(() => { setDraft(initial); }, [initial]);

  const commit = () => {
    const raw = draft.trim();
    if (raw === initial.trim()) return;
    if (field.kind === 'number') {
      if (raw === '') { onChange(null); return; }
      const n = Number(raw);
      if (Number.isFinite(n)) onChange(n); else setDraft(initial);
      return;
    }
    onChange(raw === '' ? null : draft);
  };

  return (
    <Input
      type={field.kind === 'number' ? 'number' : 'text'}
      inputMode={field.kind === 'number' ? 'decimal' : undefined}
      value={draft}
      maxLength={field.kind === 'text' ? 2000 : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      disabled={disabled}
      placeholder="Empty"
      className={INPUT}
      aria-label={field.name}
    />
  );
}
