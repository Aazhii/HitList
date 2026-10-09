/** The `[[` menu: pick a note or Notepad file to link to, or make a new page from what was typed. */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { FileCode2, FileText, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LinkKind } from '@/lib/noteLinks';

export interface LinkOption { id: string; title: string; emoji?: string; kind: LinkKind }
export type LinkChoice = { kind: 'existing'; option: LinkOption } | { kind: 'create'; title: string };

export interface LinkMenuHandle {
  /** Handles a navigation key. Returns true when the key was used. */
  handleKey: (key: string) => boolean;
}

const MAX = 8;

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The options for what has been typed: matching notes and files first (notes before files), then "Create". */
export function linkChoices(options: readonly LinkOption[], query: string): LinkChoice[] {
  const q = fold(query.trim());
  const matching = options
    .filter((o) => q === '' || fold(o.title || 'Untitled').includes(q))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1))
    .slice(0, MAX)
    .map((option): LinkChoice => ({ kind: 'existing', option }));
  const exact = options.some((o) => fold(o.title).trim() === q);
  return query.trim() && !exact ? [...matching, { kind: 'create', title: query.trim() }] : matching;
}

interface LinkMenuProps {
  position: { top: number; left: number };
  options: readonly LinkOption[];
  query: string;
  onSelect: (choice: LinkChoice) => void;
  onClose: () => void;
}

export const LinkMenu = forwardRef<LinkMenuHandle, LinkMenuProps>(function LinkMenu({ position, options, query, onSelect, onClose }, ref) {
  const choices = useMemo(() => linkChoices(options, query), [options, query]);
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [query]);

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (key === 'Escape') { onClose(); return true; }
      if (choices.length === 0) return false;
      if (key === 'ArrowDown') { setActive((i) => Math.min(i + 1, choices.length - 1)); return true; }
      if (key === 'ArrowUp') { setActive((i) => Math.max(i - 1, 0)); return true; }
      if (key === 'Enter' || key === 'Tab') { onSelect(choices[Math.min(active, choices.length - 1)]); return true; }
      return false;
    },
  }), [choices, active, onSelect, onClose]);

  return (
    <div
      data-link-menu
      role="listbox"
      aria-label="Link to a page or file"
      className="fixed z-50 max-h-[320px] w-[300px] overflow-auto rounded-[8px] border border-a-line bg-a-surface p-1.5 text-[14px] text-a-ink shadow-[var(--a-shadow-lg)] animate-fade-in"
      style={{ top: position.top, left: Math.max(8, position.left) }}
      // Choosing must not take the keyboard from the line being typed in.
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-a-faint">Link to a page or file</p>
      {choices.length === 0 && <p className="px-2 py-2 text-[13px] text-a-faint">Nothing to link to yet. Type a title to make a page.</p>}
      {choices.map((choice, i) => {
        const create = choice.kind === 'create';
        const Icon = create ? Plus : choice.option.kind === 'file' ? FileCode2 : FileText;
        const label = create ? `Create page "${choice.title}"` : choice.option.title || 'Untitled';
        return (
          <button
            key={create ? 'create' : `${choice.option.kind}:${choice.option.id}`}
            type="button"
            role="option"
            aria-selected={i === active}
            aria-label={label}
            onClick={() => onSelect(choice)}
            onMouseEnter={() => setActive(i)}
            className={cn('flex min-h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2 py-1 text-left', i === active ? 'bg-a-line-soft' : 'hover:bg-a-line-soft', create && 'text-a-accent-700')}
          >
            {!create && choice.option.emoji && choice.option.kind === 'note'
              ? <span className="w-4 text-center leading-none" aria-hidden>{choice.option.emoji}</span>
              : <Icon className="size-4 text-a-muted" strokeWidth={1.75} aria-hidden />}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {!create && choice.option.kind === 'file' && <span className="text-[11px] text-a-faint">File</span>}
          </button>
        );
      })}
    </div>
  );
});
