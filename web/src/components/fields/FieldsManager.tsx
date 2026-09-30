/**
 * Create, edit and delete custom fields — for tasks, and for a database's columns.
 *
 * An anchored popover, never a modal. It opened as a Dialog, whose overlay is a
 * fixed `bg-black/80` over the whole viewport: choosing what column to add hid
 * the very grid you were deciding about, and locked its scroll. A popover hangs
 * off whatever was clicked, leaves the page readable and scrollable behind it,
 * and flips or shifts rather than running off-screen — which is what makes it
 * usable on the last column of a wide table.
 *
 * One panel (showcase 1076–1095): the field list, the selected field's editor
 * beneath it, and Delete field / Done at the foot. A field's type is fixed once it
 * is created — changing it would leave every stored value unreadable — so the type
 * select is only enabled for a new field. Renaming an option keeps every task that
 * uses it; removing one clears it from those tasks, and the panel says so before
 * Done saves. Deleting a field asks first, saying what it would remove.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlignLeft, Calendar, CircleDot, Hash, ListChecks, Plus, SquareCheck, Trash2, Type, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { BTN_MD, topBarPill, topBarPrimary, topBarSecondary } from '@/components/shell/TopBar';
import { OPTION_DOT_CLASS } from '@/lib/fieldValues';
import type { FieldInput } from '@/lib/api';
import {
  FIELD_KIND_LABELS, OPTION_COLORS, type FieldDef, type FieldKind, type OptionColor,
} from '@/types/fields';

/** Where the popover hangs from: the rect of the control that opened it. */
export interface AnchorRect { x: number; y: number; width: number; height: number }

/** The rect of the element that was clicked, for `anchor`. */
export function anchorRectOf(el: HTMLElement): AnchorRect {
  const { x, y, width, height } = el.getBoundingClientRect();
  return { x, y, width, height };
}

interface FieldsManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null anchors to the middle of the screen — only for a keyboard-opened case. */
  anchor?: AnchorRect | null;
  fields: FieldDef[];
  /** Open straight into editing this field — the table's column menu does. */
  initialFieldId?: string | null;
  /** Open straight into a new field, for "+" in the table header. */
  startNew?: boolean;
  onCreate: (input: FieldInput) => Promise<FieldDef | null>;
  onUpdate: (id: string, input: FieldInput) => Promise<FieldDef | null>;
  onDelete: (id: string) => Promise<boolean>;
  /** How many tasks/records use an option — shown beside it ("5 tasks", "unused"). Omit to show nothing. */
  optionUsage?: (fieldId: string, optionId: string) => number;
  /** What deleting a field would remove, for the warning (showcase 967). */
  fieldUsage?: (fieldId: string) => { valueCount: number; viewNames: string[] };
  /** What the things a field is on are called: "task" (default) or "record". */
  noun?: string;
}

interface DraftOption { id?: string; label: string; color: OptionColor }
interface Draft { name: string; kind: FieldKind; options: DraftOption[]; showOnCard: boolean }

const KINDS: FieldKind[] = ['select', 'multi', 'number', 'date', 'checkbox', 'text', 'longtext'];
const KIND_ICON: Record<FieldKind, typeof Type> = {
  select: CircleDot,
  multi: ListChecks,
  number: Hash,
  date: Calendar,
  checkbox: SquareCheck,
  text: Type,
  longtext: AlignLeft,
};
const emptyDraft = (): Draft => ({ name: '', kind: 'select', options: [{ label: '', color: OPTION_COLORS[0] }], showOnCard: true });
const hasOptions = (k: FieldKind) => k === 'select' || k === 'multi';

export function FieldsManagerDialog({
  open, onOpenChange, anchor, fields, initialFieldId, startNew, onCreate, onUpdate, onDelete,
  optionUsage, fieldUsage, noun = 'task',
}: FieldsManagerDialogProps) {
  /** An id = that field is selected; 'new' = a field being created. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Index of the option whose color swatches are expanded, or null. */
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  // Close the color picker on a click outside the options list — it's plain
  // content inside this popover, not a nested overlay with its own dismiss.
  useEffect(() => {
    if (colorPickerFor === null) return;
    const handler = (e: MouseEvent) => {
      if (!optionsRef.current?.contains(e.target as Node)) setColorPickerFor(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickerFor]);

  const select = (field: FieldDef) => {
    setEditing(field.id);
    setDraft({ name: field.name, kind: field.kind, options: field.options.map((o) => ({ ...o })), showOnCard: field.showOnCard });
    setColorPickerFor(null);
  };

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    // Opened from a column menu: that field; from "+": a new one; otherwise the first.
    const asked = initialFieldId ? fields.find((f) => f.id === initialFieldId) : undefined;
    if (asked) { select(asked); return; }
    if (startNew || fields.length === 0) { setEditing('new'); setDraft(emptyDraft()); return; }
    select(fields[0]);
    // `anchor` is a fresh object on every open request (anchorRectOf/activeAnchor
    // always return a new literal) even when the popover was already open — e.g.
    // clicking "New column" again right after creating one, without closing the
    // popover in between. `open` alone only catches the closed→open transition,
    // so without this a second click while still open silently did nothing.
  }, [open, initialFieldId, startNew, anchor]);

  const current = editing && editing !== 'new' ? fields.find((f) => f.id === editing) : undefined;
  const removedOptions = current && hasOptions(current.kind)
    ? current.options.filter((o) => !draft.options.some((d) => d.id === o.id))
    : [];

  const setOption = (i: number, patch: Partial<DraftOption>) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));

  const inputFor = (): FieldInput => ({
    name: draft.name.trim(),
    kind: draft.kind,
    showOnCard: draft.showOnCard,
    ...(hasOptions(draft.kind) ? { options: draft.options.filter((o) => o.label.trim()) } : {}),
  });

  /** Whether the draft differs from what is stored, so Done doesn't rewrite an untouched field. */
  const changed = (() => {
    if (editing === 'new') return draft.name.trim() !== '';
    if (!current) return false;
    return JSON.stringify(inputFor()) !== JSON.stringify({
      name: current.name,
      kind: current.kind,
      showOnCard: current.showOnCard,
      ...(hasOptions(current.kind) ? { options: current.options.map((o) => ({ ...o })) } : {}),
    });
  })();

  // Done saves what was edited, then closes. An unnamed new field is simply dropped.
  const done = async () => {
    if (!changed || !draft.name.trim()) { onOpenChange(false); return; }
    setSaving(true);
    const ok = editing === 'new' ? await onCreate(inputFor()) : await onUpdate(editing!, inputFor());
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  // Moving to another field keeps what was typed: it is saved first.
  const choose = async (field: FieldDef) => {
    if (field.id === editing) return;
    if (changed && draft.name.trim()) {
      setSaving(true);
      const ok = editing === 'new' ? await onCreate(inputFor()) : await onUpdate(editing!, inputFor());
      setSaving(false);
      if (!ok) return;
    }
    select(field);
  };

  const startNewField = async () => {
    if (editing !== 'new' && changed && draft.name.trim()) {
      setSaving(true);
      const ok = await onUpdate(editing!, inputFor());
      setSaving(false);
      if (!ok) return;
    }
    setEditing('new');
    setDraft(emptyDraft());
    setColorPickerFor(null);
  };

  const usage = current && fieldUsage ? fieldUsage(current.id) : { valueCount: 0, viewNames: [] as string[] };
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <>
      <Popover open={open && !confirmDelete} onOpenChange={onOpenChange}>
        {/* A zero-size anchor at the trigger's rect. The popover is rendered from
            the page root, far from the button that opened it, so there is no
            element here to hang off otherwise. */}
        <PopoverAnchor asChild>
          <span
            aria-hidden
            style={anchor
              ? { position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }
              : { position: 'fixed', left: '50%', top: '20%' }}
          />
        </PopoverAnchor>

        {/* Showcase 1076–1095: 440px, 12px radius, shadow-xl, list / editor / footer. */}
        <PopoverContent
          role="dialog"
          aria-label="Fields"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          className="flex max-h-[min(640px,80vh)] w-[min(440px,92vw)] flex-col gap-0 overflow-hidden rounded-[12px] border border-a-line p-0 text-[13px] leading-normal text-a-muted shadow-[var(--a-shadow-xl)]"
        >
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-a-line-soft px-4 py-3.5">
            <span className="text-[14px] font-semibold text-a-ink">Fields</span>
            <div className="flex-1" />
            <button type="button" className={topBarSecondary} onClick={() => void startNewField()}>
              <Plus className="size-4" strokeWidth={1.75} aria-hidden />
              New field
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {fields.length > 0 && (
              <div className="flex flex-col gap-0.5 px-2 pt-2">
                {fields.map((field) => {
                  const Icon = KIND_ICON[field.kind];
                  const on = field.id === editing;
                  return (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => void choose(field)}
                      aria-current={on ? 'true' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left transition-colors duration-[120ms]',
                        on ? 'bg-a-blue-tint' : 'hover:bg-a-bg',
                      )}
                    >
                      <Icon className="size-[15px] flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
                      <span className={cn('flex-1 truncate text-a-ink', on && 'font-semibold')}>{field.name}</span>
                      <span className="text-[12px] text-a-faint">{FIELD_KIND_LABELS[field.kind]}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mx-4 mt-2 flex flex-col gap-3 border-t border-a-line-soft py-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <label className="text-[13px] font-medium leading-[1.35] text-a-ink" htmlFor="field-name">Name</label>
                  <Input
                    id="field-name"
                    autoFocus={editing === 'new'}
                    className="h-7 px-2"
                    value={draft.name}
                    maxLength={100}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Effort"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-medium leading-[1.35] text-a-ink">Type</span>
                  {/* A field's type is fixed once it exists — changing it would strand every stored value. */}
                  <Select
                    value={draft.kind}
                    disabled={editing !== 'new'}
                    onValueChange={(k) => setDraft((d) => ({ ...d, kind: k as FieldKind }))}
                  >
                    <SelectTrigger size="sm" className="w-full" aria-label="Type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => <SelectItem key={k} value={k}>{FIELD_KIND_LABELS[k]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {hasOptions(draft.kind) && (
                <div ref={optionsRef}>
                  <div className="mb-1.5 font-medium text-a-ink">Options</div>
                  <div className="flex flex-col gap-1.5">
                    {draft.options.map((option, i) => {
                      const n = option.id && optionUsage ? optionUsage(current?.id ?? '', option.id) : null;
                      return (
                        <div key={option.id ?? `new-${i}`}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={`Colour for ${option.label || 'option'}`}
                              aria-expanded={colorPickerFor === i}
                              title="Change colour"
                              onClick={() => setColorPickerFor((cur) => (cur === i ? null : i))}
                              className={cn('size-3.5 flex-shrink-0 rounded-[4px]', OPTION_DOT_CLASS[option.color])}
                            />
                            <input
                              value={option.label}
                              maxLength={60}
                              onChange={(e) => setOption(i, { label: e.target.value })}
                              placeholder={`Option ${i + 1}`}
                              aria-label={`Option ${i + 1}`}
                              className="min-w-0 flex-1 rounded-[4px] border border-a-line bg-a-surface px-2 py-1 text-a-ink outline-none placeholder:text-a-faint focus-visible:border-a-accent focus-visible:shadow-[0_0_0_3px_var(--a-accent-ring)]"
                            />
                            {n !== null && (
                              <span className="min-w-14 text-right text-[12px] text-a-faint">
                                {n === 0 ? 'unused' : plural(n, noun)}
                              </span>
                            )}
                            <button
                              type="button"
                              aria-label={`Remove ${option.label || 'option'}`}
                              onClick={() => setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))}
                              className="flex size-7 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink"
                            >
                              <X className="size-4" strokeWidth={1.75} />
                            </button>
                          </div>
                          {colorPickerFor === i && (
                            <div className="mt-1 mb-0.5 ml-1 flex flex-wrap gap-1.5 rounded-[6px] bg-a-bg p-2" role="group" aria-label="Colour">
                              {OPTION_COLORS.map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  aria-label={color}
                                  aria-pressed={option.color === color}
                                  onClick={() => { setOption(i, { color }); setColorPickerFor(null); }}
                                  className={cn(
                                    'size-5 rounded-[4px]',
                                    OPTION_DOT_CLASS[color],
                                    option.color === color && 'shadow-[0_0_0_2px_var(--a-surface),0_0_0_3.5px_var(--a-accent)]',
                                  )}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {draft.options.length < 50 && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        className={topBarPill}
                        onClick={() => setDraft((d) => ({ ...d, options: [...d.options, { label: '', color: OPTION_COLORS[d.options.length % OPTION_COLORS.length] }] }))}
                      >
                        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                        Add option
                      </button>
                    </div>
                  )}
                  {removedOptions.length > 0 && (
                    <p className="mt-2 text-[12px] text-a-red-ink">
                      Saving removes {removedOptions.map((o) => `“${o.label}”`).join(', ')} from every {noun} that uses {removedOptions.length === 1 ? 'it' : 'them'}.
                    </p>
                  )}
                </div>
              )}

              <Checkbox
                label="Show on cards"
                checked={draft.showOnCard}
                onChange={(e) => setDraft((d) => ({ ...d, showOnCard: e.target.checked }))}
              />
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2 border-t border-a-line-soft px-4 py-3">
            {current && (
              <button type="button" className={topBarPill} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                Delete field
              </button>
            )}
            <div className="flex-1" />
            <button type="button" className={topBarPrimary} disabled={saving} onClick={() => void done()}>
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* ov-fielddelete — showcase 967–969. The fields panel steps aside while it is open. */}
      <Dialog open={open && confirmDelete && !!current} onOpenChange={(v) => { if (!v) setConfirmDelete(false); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete the “{current?.name}” field?</DialogTitle>
            <DialogDescription>
              {usage.valueCount === 0
                ? `No ${noun} has a value in it.`
                : `It has a value on ${plural(usage.valueCount, noun)}`}
              {usage.viewNames.length > 0 && ` and is used by ${plural(usage.viewNames.length, 'saved view')}: ${usage.viewNames.join(' and ')}`}
              {usage.valueCount === 0 && usage.viewNames.length === 0 ? '' : '.'}
              {' '}The {noun}s are kept; only their {current?.name} values are removed. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={cn(topBarPill, BTN_MD)} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={cn(
                'flex flex-shrink-0 items-center gap-2 border border-transparent bg-a-red-line font-semibold whitespace-nowrap text-white transition-colors duration-[120ms] hover:bg-a-red-ink',
                BTN_MD,
              )}
              onClick={async () => {
                if (!current) return;
                if (await onDelete(current.id)) { setConfirmDelete(false); onOpenChange(false); }
              }}
            >
              {usage.valueCount > 0 ? `Delete field and ${plural(usage.valueCount, 'value')}` : 'Delete field'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
