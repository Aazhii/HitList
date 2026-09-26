/**
 * "Save as view", at the foot of the filter popover.
 *
 * Saves what is on screen now: the filters, the sort, List or Matrix, and
 * whether completed tasks show — and, if asked, the list that is open.
 */
import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SaveViewFormProps {
  listName: string;
  onSave: (name: string, scopeToList: boolean) => Promise<boolean>;
}

export function SaveViewForm({ listName, onSave }: SaveViewFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scoped, setScoped] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const ok = await onSave(trimmed, scoped);
    setSaving(false);
    if (ok) { setOpen(false); setName(''); }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-a-accent-700 transition-colors duration-150 hover:text-a-accent"
      >
        <Bookmark className="size-3.5" strokeWidth={2.75} aria-hidden />
        Save as view
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2.5 rounded-[12px] bg-a-surface p-3">
      <Input
        autoFocus
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="View name, e.g. Overdue at work"
        className="h-8 rounded-full text-[14px]"
        aria-label="View name"
      />
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-a-ink">
        <input
          type="checkbox"
          checked={scoped}
          onChange={(e) => setScoped(e.target.checked)}
          className="size-3.5 accent-[var(--a-accent)]"
        />
        Always open in <span className="font-semibold">{listName}</span>
      </label>
      <p className="text-[12px] leading-relaxed text-a-faint">
        {scoped
          ? `Picking this view switches to ${listName}.`
          : 'Picking this view keeps whichever list is open.'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!name.trim() || saving}
          className="h-7 flex-1 rounded-full bg-a-accent px-3 text-[13px] font-semibold text-a-bg transition-colors duration-150 hover:bg-a-accent-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save view'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-7 rounded-full px-3 text-[13px] text-a-muted transition-colors duration-150 hover:text-a-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
