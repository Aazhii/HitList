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

const ICON = 'size-3.5';
const STROKE = 2.75;

export const SLASH_COMMANDS: SlashCommand[] = [
  { trigger: 'text',     label: 'Text',          description: 'Plain paragraph',       type: 'paragraph', icon: <Type className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'h1',       label: 'Heading 1',     description: 'Large section heading', type: 'heading1',  icon: <Heading1 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'h2',       label: 'Heading 2',     description: 'Medium heading',        type: 'heading2',  icon: <Heading2 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'h3',       label: 'Heading 3',     description: 'Small heading',         type: 'heading3',  icon: <Heading3 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'bullet',   label: 'Bullet list',   description: 'Unordered list',        type: 'bullet',    icon: <List className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'numbered', label: 'Numbered list', description: 'Ordered list',          type: 'numbered',  icon: <ListOrdered className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'todo',     label: 'To-do',         description: 'Checkbox list',         type: 'todo',      icon: <CheckSquare className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'quote',    label: 'Quote',         description: 'Highlighted quote',     type: 'quote',     icon: <Quote className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'divider',  label: 'Divider',       description: 'Horizontal rule',       type: 'divider',   icon: <Minus className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'code',     label: 'Code',          description: 'Code block',            type: 'code',      icon: <Code2 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'table',    label: 'Table',         description: 'Insert a table',        type: 'table',     icon: <Table2 className={ICON} strokeWidth={STROKE} /> },
];

/**
 * The commands matching a query, one per block type.
 *
 * The menu renders this list and the editor's keyboard handler indexes into it,
 * so both must compute it identically. It used to be written out separately in
 * each file; a change to one would have made ↵ select a different command from
 * the one highlighted.
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter(
    (cmd, i, arr) =>
      arr.findIndex((c) => c.type === cmd.type) === i &&
      (q === '' || cmd.trigger.startsWith(q) || cmd.label.toLowerCase().includes(q)),
  );
}

interface SlashMenuProps {
  query: string;
  position: { top: number; left: number };
  onSelect: (type: BlockType) => void;
  onClose: () => void;
  selectedIndex: number;
}

/** Approximate row height, for deciding whether to flip the menu above the caret. */
const ROW_PX = 50;
const LIST_MAX_PX = 264;
const CHROME_PX = 72;

export function SlashMenu({ query, position, onSelect, selectedIndex }: SlashMenuProps) {
  const filtered = filterSlashCommands(query);

  // On the scrolling list itself, not the menu wrapper. The ref used to sit on
  // the wrapper, whose children are the header, the list and the footer — so
  // children[selectedIndex] picked those, and keyboard navigation never scrolled
  // the list at all.
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[selectedIndex] as HTMLElement | undefined;
    if (!list || !item) return;

    // Explicit arithmetic on the list's own scrollTop. scrollIntoView() also
    // scrolls every scrollable ancestor, which moved the whole editor pane.
    // offsetTop is relative to the list because the list is `relative`.
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  const viewportH = window.innerHeight;
  const menuH = Math.min(filtered.length * ROW_PX, LIST_MAX_PX) + CHROME_PX;
  const top = position.top + menuH > viewportH - 8 ? position.top - menuH - 4 : position.top;

  return (
    <div
      data-slash-menu
      className="fixed z-50 w-60 overflow-hidden rounded-[16px] border border-a-line bg-a-bg text-a-ink shadow-[var(--a-shadow-md)] animate-fade-in"
      style={{ top, left: Math.max(8, position.left) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-3.5 pt-2.5 pb-1.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint">Block type</p>
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-label="Block types"
        className="relative overflow-y-auto px-1.5 pb-1.5"
        style={{ maxHeight: LIST_MAX_PX }}
      >
        {filtered.map((cmd, i) => (
          <button
            key={cmd.type}
            type="button"
            role="option"
            aria-selected={i === selectedIndex}
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.type); }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors duration-100',
              i === selectedIndex ? 'bg-a-accent-tint' : 'hover:bg-a-row-hover',
            )}
          >
            <span
              className={cn(
                'flex size-6 flex-shrink-0 items-center justify-center rounded-[8px]',
                i === selectedIndex ? 'bg-a-bg text-a-accent-700' : 'bg-a-surface text-a-muted',
              )}
            >
              {cmd.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] leading-tight text-a-ink">{cmd.label}</span>
              <span className="block text-[12.5px] leading-tight text-a-faint">{cmd.description}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-a-line-soft px-3.5 py-2 text-[12px] text-a-faint">
        <kbd className="font-mono">↑↓</kbd>
        <span>navigate</span>
        <kbd className="ml-1 font-mono">↵</kbd>
        <span>select</span>
        <kbd className="ml-1 font-mono">Esc</kbd>
        <span>close</span>
      </div>
    </div>
  );
}
