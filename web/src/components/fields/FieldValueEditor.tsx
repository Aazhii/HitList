/**
 * The editor for one task's value of one custom field.
 *
 * Select, multi-select, date and checkbox save on change. Number and text
 * save when the input loses focus or on Enter, so typing "120" is one save,
 * not three.
 */
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
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
  /** Called after picking a multi-select option, so a caller showing this in
   * a popover can close it — multi has no built-in "closed" moment the way
   * a native select does, since picking one option doesn't mean you're done. */
  onSelectOption?: () => void;
}

const INPUT = 'h-9 w-full rounded-xl border-0 bg-muted/30 text-xs focus-visible:ring-1 focus-visible:ring-primary/40';

export function FieldValueEditor({ field, value, onChange, disabled, onSelectOption }: FieldValueEditorProps) {
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
        <div className="space-y-1" role="listbox" aria-label={field.name} aria-multiselectable="true">
          {field.options.map((o) => {
            const on = chosen.has(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={on}
                disabled={disabled}
                onClick={() => {
                  const next = new Set(chosen);
                  if (on) next.delete(o.id); else next.add(o.id);
                  // In the field's option order, so the stored list is stable.
                  const ordered = field.options.map((x) => x.id).filter((id) => next.has(id));
                  onChange(ordered.length ? ordered : null);
                  onSelectOption?.();
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-opacity duration-[120ms]',
                  OPTION_CHIP_CLASS[o.color],
                  on ? 'opacity-100' : 'opacity-50 hover:opacity-80',
                )}
              >
                <Check className={cn('size-3.5 flex-shrink-0', !on && 'opacity-0')} aria-hidden />
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

    // A wrapping box, not a one-line input — the whole reason the kind exists.
    case 'longtext':
      return <CommitOnBlurTextArea field={field} value={value} onChange={onChange} disabled={disabled} />;
  }
}

function CommitOnBlurTextArea({ field, value, onChange, disabled }: FieldValueEditorProps) {
  const initial = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(initial); }, [initial]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [draft]);

  return (
    <textarea
      ref={ref}
      rows={2}
      value={draft}
      maxLength={10_000}
      disabled={disabled}
      placeholder="Empty"
      aria-label={field.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() !== initial.trim()) onChange(draft.trim() === '' ? null : draft); }}
      // Enter makes a new line here; Escape reverts, matching the table cell.
      onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); } }}
      className={cn(INPUT, 'h-auto resize-none py-1.5 leading-[1.5]')}
    />
  );
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
