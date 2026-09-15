/**
 * Create, edit and delete custom task fields.
 *
 * A field's type is fixed once it is created — changing it would leave every
 * stored value unreadable — so the type picker is only shown for a new field.
 * Renaming an option keeps every task that uses it; removing one clears it
 * from those tasks, and the dialog says so before saving.
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2, X, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OPTION_DOT_CLASS } from '@/lib/fieldValues';
import type { FieldInput } from '@/lib/api';
import {
  FIELD_KIND_LABELS, OPTION_COLORS, type FieldDef, type FieldKind, type OptionColor,
} from '@/types/fields';

interface FieldsManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: FieldDef[];
  onCreate: (input: FieldInput) => Promise<FieldDef | null>;
  onUpdate: (id: string, input: FieldInput) => Promise<FieldDef | null>;
  onDelete: (id: string) => Promise<boolean>;
}

interface DraftOption { id?: string; label: string; color: OptionColor }
interface Draft { name: string; kind: FieldKind; options: DraftOption[]; showOnCard: boolean }

const KINDS: FieldKind[] = ['select', 'multi', 'number', 'date', 'checkbox', 'text'];
const emptyDraft = (): Draft => ({ name: '', kind: 'select', options: [{ label: '', color: 'accent' }], showOnCard: true });
const hasOptions = (k: FieldKind) => k === 'select' || k === 'multi';

export function FieldsManagerDialog({ open, onOpenChange, fields, onCreate, onUpdate, onDelete }: FieldsManagerDialogProps) {
  /** null = the list; 'new' = creating; an id = editing that field. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setEditing(fields.length === 0 ? 'new' : null); setDraft(emptyDraft()); setConfirmDelete(null); }
  }, [open]);

  const current = editing && editing !== 'new' ? fields.find((f) => f.id === editing) : undefined;
  const removedOptions = current && hasOptions(current.kind)
    ? current.options.filter((o) => !draft.options.some((d) => d.id === o.id))
    : [];

  const startEdit = (field: FieldDef) => {
    setEditing(field.id);
    setDraft({ name: field.name, kind: field.kind, options: field.options.map((o) => ({ ...o })), showOnCard: field.showOnCard });
  };

  const setOption = (i: number, patch: Partial<DraftOption>) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));

  const save = async () => {
    const input: FieldInput = {
      name: draft.name.trim(),
      kind: draft.kind,
      showOnCard: draft.showOnCard,
      ...(hasOptions(draft.kind) ? { options: draft.options.filter((o) => o.label.trim()) } : {}),
    };
    if (!input.name) return;
    setSaving(true);
    const ok = editing === 'new' ? await onCreate(input) : await onUpdate(editing!, input);
    setSaving(false);
    if (ok) { setEditing(null); setDraft(emptyDraft()); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <SlidersHorizontal className="size-4 text-primary" />
            Task fields
          </DialogTitle>
        </DialogHeader>

        {editing === null ? (
          <div className="space-y-2 pt-1">
            {fields.map((field) => (
              <div key={field.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{field.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {FIELD_KIND_LABELS[field.kind]}
                    {hasOptions(field.kind) ? ` · ${field.options.length} option${field.options.length === 1 ? '' : 's'}` : ''}
                    {field.showOnCard ? ' · on cards' : ''}
                  </p>
                </div>
                {confirmDelete === field.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">Remove from every task?</span>
                    <Button
                      size="sm" variant="destructive" className="h-7 rounded-lg text-xs"
                      onClick={async () => { if (await onDelete(field.id)) setConfirmDelete(null); }}
                    >
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 rounded-lg text-xs" onClick={() => setConfirmDelete(null)}>Keep</Button>
                  </div>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 rounded-lg text-xs" onClick={() => startEdit(field)}>Edit</Button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(field.id)}
                      aria-label={`Delete ${field.name}`}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
            <Button className="w-full gap-2 rounded-xl" onClick={() => { setEditing('new'); setDraft(emptyDraft()); }}>
              <Plus className="size-3.5" /> New field
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Name</p>
              <Input
                autoFocus value={draft.name} maxLength={100}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Effort"
                className="rounded-xl text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Type</p>
              {editing === 'new' ? (
                <Select value={draft.kind} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as FieldKind }))}>
                  <SelectTrigger className="h-9 w-full rounded-xl text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => <SelectItem key={k} value={k}>{FIELD_KIND_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {FIELD_KIND_LABELS[draft.kind]} — a field's type can't change after it's created.
                </p>
              )}
            </div>

            {hasOptions(draft.kind) && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Options</p>
                {draft.options.map((option, i) => (
                  <div key={option.id ?? `new-${i}`} className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Colour for ${option.label || 'option'}`}
                      title="Change colour"
                      onClick={() => setOption(i, { color: OPTION_COLORS[(OPTION_COLORS.indexOf(option.color) + 1) % OPTION_COLORS.length] })}
                      className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg hover:bg-muted"
                    >
                      <span className={cn('size-3 rounded-full', OPTION_DOT_CLASS[option.color])} />
                    </button>
                    <Input
                      value={option.label} maxLength={60}
                      onChange={(e) => setOption(i, { label: e.target.value })}
                      placeholder={`Option ${i + 1}`}
                      className="h-8 rounded-xl text-xs"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${option.label || 'option'}`}
                      onClick={() => setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))}
                      className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {draft.options.length < 50 && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, options: [...d.options, { label: '', color: OPTION_COLORS[d.options.length % OPTION_COLORS.length] }] }))}
                    className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-3" /> Add option
                  </button>
                )}
                {removedOptions.length > 0 && (
                  <p className="text-[11px] text-destructive">
                    Saving removes {removedOptions.map((o) => `“${o.label}”`).join(', ')} from every task that uses {removedOptions.length === 1 ? 'it' : 'them'}.
                  </p>
                )}
              </div>
            )}

            <label className="flex cursor-pointer items-center justify-between rounded-xl bg-muted/30 px-3.5 py-2.5 text-xs">
              <span>Show on task cards</span>
              <Switch checked={draft.showOnCard} onCheckedChange={(on) => setDraft((d) => ({ ...d, showOnCard: on }))} />
            </label>

            <div className="flex gap-2">
              <Button
                variant="ghost" className="rounded-xl"
                onClick={() => (fields.length ? setEditing(null) : onOpenChange(false))}
              >
                Cancel
              </Button>
              <Button className="flex-1 rounded-xl" disabled={!draft.name.trim() || saving} onClick={() => void save()}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create field' : 'Save field'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
