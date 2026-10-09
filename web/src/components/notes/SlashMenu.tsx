import { useRef, useEffect } from 'react';
import {
  Columns3, Link2, Type, Heading1, Heading2, Heading3, List, ListOrdered,
  CheckSquare, ChevronRight, Quote, Minus, Code2, Table2, Lightbulb, FileCode2, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlockType } from '@/types/notes';

/** What a command sets up beyond changing the block's type: the database group (showcase 1753). */
export type SlashAction = 'db-table' | 'db-board' | 'db-linked' | 'file-pick' | 'page-new';

export interface SlashCommand {
  trigger: string;
  label: string;
  description: string;
  type: BlockType;
  icon: React.ReactNode;
  /** Present on the database group: it makes or picks a database for the block. */
  action?: SlashAction;
}

const ICON = 'size-[15px]';
const STROKE = 1.75;

export const SLASH_COMMANDS: SlashCommand[] = [
  { trigger: 'text',     label: 'Text',          description: 'Plain paragraph',       type: 'paragraph', icon: <Type className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'h1',       label: 'Heading 1',     description: 'Large section heading', type: 'heading1',  icon: <Heading1 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'h2',       label: 'Heading 2',     description: 'Medium heading',        type: 'heading2',  icon: <Heading2 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'h3',       label: 'Heading 3',     description: 'Small heading',         type: 'heading3',  icon: <Heading3 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'bullet',   label: 'Bullet list',   description: 'Unordered list',        type: 'bullet',    icon: <List className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'numbered', label: 'Numbered list', description: 'Ordered list',          type: 'numbered',  icon: <ListOrdered className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'todo',     label: 'To-do',         description: 'Checkbox list',         type: 'todo',      icon: <CheckSquare className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'toggle',   label: 'Toggle list',   description: 'Hide or show what is inside it', type: 'toggle', icon: <ChevronRight className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'quote',    label: 'Quote',         description: 'Highlighted quote',     type: 'quote',     icon: <Quote className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'callout',  label: 'Callout',       description: 'Tinted note with an icon', type: 'callout', icon: <Lightbulb className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'divider',  label: 'Divider',       description: 'Horizontal rule',       type: 'divider',   icon: <Minus className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'code',     label: 'Code',          description: 'Code block',            type: 'code',      icon: <Code2 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'table',    label: 'Table',         description: 'Insert a table',        type: 'table',     icon: <Table2 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'database', label: 'Create database', description: 'A new table inside this note', type: 'database', action: 'db-table', icon: <Table2 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'board',    label: 'Create board',    description: 'A new database shown as a board', type: 'database', action: 'db-board', icon: <Columns3 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'page',     label: 'Page',          description: 'A new page inside this one', type: 'page', action: 'page-new', icon: <FileText className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'file',     label: 'Notepad file',  description: 'Show a Notepad file here, editable', type: 'codefile', action: 'file-pick', icon: <FileCode2 className={ICON} strokeWidth={STROKE} /> },
  { trigger: 'linked',   label: 'Linked view of a database', description: 'Show an existing database here', type: 'database', action: 'db-linked', icon: <Link2 className={ICON} strokeWidth={STROKE} /> },
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
      arr.findIndex((c) => (c.action ?? c.type) === (cmd.action ?? cmd.type)) === i &&
      (q === '' || cmd.trigger.startsWith(q) || cmd.label.toLowerCase().includes(q)),
  );
}

interface SlashMenuProps {
  query: string;
  position: { top: number; left: number };
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  selectedIndex: number;
}

/** Approximate row height, for deciding whether to flip the menu above the caret. */
const ROW_PX = 50;
/** The panel's own ceiling (showcase 551): it scrolls past this. */
const PANEL_MAX_PX = 420;
/** The group caption above the rows plus the hint below them. */
const CHROME_PX = 28 + 38;

export function SlashMenu({ query, position, onSelect, selectedIndex }: SlashMenuProps) {
  const filtered = filterSlashCommands(query);

  // The panel is the scroller (showcase 551), the rows sit in a listbox inside it.
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const list = listRef.current;
    const item = list?.children[selectedIndex] as HTMLElement | undefined;
    if (!panel || !list || !item) return;

    // Explicit arithmetic on the panel's own scrollTop. scrollIntoView() also
    // scrolls every scrollable ancestor, which moved the whole editor pane.
    // offsetTop is relative to the panel because the panel is positioned.
    const top = list.offsetTop + item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < panel.scrollTop) {
      panel.scrollTop = top;
    } else if (bottom > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = bottom - panel.clientHeight;
    }
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  const viewportH = window.innerHeight;
  const menuH = Math.min(filtered.length * ROW_PX + CHROME_PX, PANEL_MAX_PX);
  const top = position.top + menuH > viewportH - 8 ? position.top - menuH - 4 : position.top;

  return (
    <div
      ref={panelRef}
      data-slash-menu
      className="fixed z-50 max-h-[420px] w-[300px] overflow-auto rounded-[8px] border border-a-line bg-a-surface p-1.5 text-[14px] text-a-ink shadow-[var(--a-shadow-lg)] animate-fade-in"
      style={{ top, left: Math.max(8, position.left) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={listRef} role="listbox" aria-label="Block types">
        {filtered.map((cmd, i) => (
          <div key={cmd.action ?? cmd.type}>
            {/* The caption above each group, once (showcase 552, 561). */}
            {(i === 0 || !!filtered[i - 1].action !== !!cmd.action) && (
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-a-faint">
                {cmd.action ? 'Database' : 'Basic blocks'}
              </p>
            )}
            <button
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              onMouseDown={(e) => { e.preventDefault(); onSelect(cmd); }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-colors duration-[120ms]',
                i === selectedIndex ? 'bg-a-blue-tint' : 'hover:bg-a-line-soft',
              )}
            >
              <span className="flex size-7 flex-shrink-0 items-center justify-center rounded-[6px] border border-a-line bg-a-surface text-a-muted">
                {cmd.icon}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium">{cmd.label}</span>
                <span className="text-[12px] text-a-faint">{cmd.description}</span>
              </span>
            </button>
          </div>
        ))}
      </div>

      <p className="mt-1 border-t border-a-line-soft p-2 text-[11px] text-a-faint">↑↓ to move · ↵ to select · esc to close</p>
    </div>
  );
}
