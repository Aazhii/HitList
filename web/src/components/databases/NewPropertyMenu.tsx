/**
 * New property (showcase 696–705): a name field and the list of types — pick a type and the
 * property is created. Opened from the header's "+", the page's "New column", and a column
 * menu's Insert left / right.
 */
import { useEffect, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { FIELD_KIND_LABELS, type FieldKind } from '@/types/fields';
import type { AnchorRect } from '@/components/fields/FieldsManager';
import type { FieldInput } from '@/lib/api';

interface NewPropertyMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor?: AnchorRect | null;
  kinds: readonly FieldKind[];
  kindIcon: Record<FieldKind, React.ComponentType<{ className?: string; strokeWidth?: number }>>;
  onCreate: (input: FieldInput) => Promise<unknown>;
}

export function NewPropertyMenu({ open, onOpenChange, anchor, kinds, kindIcon, onCreate }: NewPropertyMenuProps) {
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open, anchor]);

  const create = async (kind: FieldKind) => {
    onOpenChange(false);
    // Unnamed, a property is called after its type, as Notion does.
    await onCreate({ name: name.trim() || FIELD_KIND_LABELS[kind], kind, showOnCard: true });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={anchor
            ? { position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }
            : { position: 'fixed', left: '50%', top: '20%' }}
        />
      </PopoverAnchor>
      <PopoverContent
        role="dialog"
        aria-label="New property"
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="max-h-[460px] w-[250px] gap-0 overflow-auto p-1.5 text-[14px]"
      >
        <div className="px-0.5 pb-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Property name"
            aria-label="Property name"
            maxLength={100}
            className="h-[30px] w-full rounded-[4px] border border-a-line bg-a-surface px-2 text-[14px] text-a-ink outline-none placeholder:text-a-faint focus-visible:border-a-accent"
          />
        </div>
        <div className="px-2 py-1 text-[12px] text-a-faint">Select type</div>
        {kinds.map((kind) => {
          const Icon = kindIcon[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => void create(kind)}
              className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[4px] px-2 py-[5px] text-left leading-[normal] text-a-ink transition-colors duration-[120ms] hover:bg-a-line-soft"
            >
              <Icon className="size-4 flex-shrink-0" strokeWidth={1.75} />
              <span className="flex-1">{FIELD_KIND_LABELS[kind]}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
