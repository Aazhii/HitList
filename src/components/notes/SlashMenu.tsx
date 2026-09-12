import { useRef, useEffect } from 'react';
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered,
  CheckSquare, Quote, Minus, Code2, Table2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlockType } from '@/types/notes';

interface SlashCommand {
  trigger: string;
  label: string;
  description: string;
  type: BlockType;
  icon: React.ReactNode;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { trigger: 'text',     label: 'Text',         description: 'Plain paragraph',       type: 'paragraph', icon: <Type className="size-3.5" /> },
  { trigger: 'h1',       label: 'Heading 1',    description: 'Large section heading', type: 'heading1',  icon: <Heading1 className="size-3.5" /> },
  { trigger: 'h2',       label: 'Heading 2',    description: 'Medium heading',        type: 'heading2',  icon: <Heading2 className="size-3.5" /> },
  { trigger: 'h3',       label: 'Heading 3',    description: 'Small heading',         type: 'heading3',  icon: <Heading3 className="size-3.5" /> },
  { trigger: 'bullet',   label: 'Bullet list',  description: 'Unordered list',        type: 'bullet',    icon: <List className="size-3.5" /> },
  { trigger: 'numbered', label: 'Numbered list', description: 'Ordered list',         type: 'numbered',  icon: <ListOrdered className="size-3.5" /> },
  { trigger: 'todo',     label: 'To-do',        description: 'Checkbox list',         type: 'todo',      icon: <CheckSquare className="size-3.5" /> },
  { trigger: 'quote',    label: 'Quote',        description: 'Highlighted quote',     type: 'quote',     icon: <Quote className="size-3.5" /> },
  { trigger: 'divider',  label: 'Divider',      description: 'Horizontal rule',       type: 'divider',   icon: <Minus className="size-3.5" /> },
  { trigger: 'code',     label: 'Code',         description: 'Code block',            type: 'code',      icon: <Code2 className="size-3.5" /> },
  { trigger: 'table',    label: 'Table',        description: 'Insert a table',        type: 'table',     icon: <Table2 className="size-3.5" /> },
];

interface SlashMenuProps {
  query: string;
  position: { top: number; left: number };
  onSelect: (type: BlockType) => void;
  onClose: () => void;
  selectedIndex: number;
}

export function SlashMenu({ query, position, onSelect, onClose, selectedIndex }: SlashMenuProps) {
  const filtered = SLASH_COMMANDS.filter(
    (cmd, i, arr) =>
      arr.findIndex((c) => c.type === cmd.type) === i &&
      (query === '' ||
        cmd.trigger.startsWith(query.toLowerCase()) ||
        cmd.label.toLowerCase().includes(query.toLowerCase()))
  );

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = menuRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  const viewportH = window.innerHeight;
  const menuH = Math.min(filtered.length * 44 + 72, 280);
  const top = position.top + menuH > viewportH - 8 ? position.top - menuH - 4 : position.top;

  return (
    <div
      ref={menuRef}
      data-slash-menu
      className="fixed z-50 w-60 rounded-xl border border-border bg-popover shadow-xl overflow-hidden animate-fade-in"
      style={{ top, left: Math.max(8, position.left) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-2.5 py-1.5 border-b border-border/50">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Block type
        </p>
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {filtered.map((cmd, i) => (
          <button
            key={cmd.type}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.type); }}
            className={cn(
              'w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors duration-100',
              i === selectedIndex
                ? 'bg-primary/10 text-foreground'
                : 'text-foreground hover:bg-muted/60'
            )}
          >
            <span className="size-6 rounded-md bg-muted/60 flex items-center justify-center flex-shrink-0 text-muted-foreground">
              {cmd.icon}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium leading-none">{cmd.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{cmd.description}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="px-2.5 py-1.5 border-t border-border/50 flex items-center gap-2">
        <kbd className="text-[9px] font-mono bg-muted/60 px-1 rounded text-muted-foreground">↑↓</kbd>
        <span className="text-[10px] text-muted-foreground">navigate</span>
        <kbd className="text-[9px] font-mono bg-muted/60 px-1 rounded text-muted-foreground ml-1">↵</kbd>
        <span className="text-[10px] text-muted-foreground">select</span>
        <kbd className="text-[9px] font-mono bg-muted/60 px-1 rounded text-muted-foreground ml-1">Esc</kbd>
        <span className="text-[10px] text-muted-foreground">close</span>
      </div>
    </div>
  );
}
