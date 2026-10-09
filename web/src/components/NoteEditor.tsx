import {
  useRef, useEffect, useCallback, useState, useMemo, Fragment,
  KeyboardEvent,
} from 'react';
import {
  Plus, GripVertical, Trash2, ArrowUp, ArrowDown,
  Type, Heading1, Heading2, Heading3, List, ListOrdered,
  CheckSquare, ChevronRight, Quote, Minus, Code2, Table2, Lightbulb,
  Bold, Italic, Underline, Strikethrough, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteBlock, BlockType, TableData, CalloutTone } from '@/types/notes';
import { BLOCK_TYPE_LABELS, NOTE_EMOJIS, createEmptyBlock } from '@/types/notes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SlashMenu, filterSlashCommands, type SlashCommand } from '@/components/notes/SlashMenu';
import { DatabaseBlock } from '@/components/notes/DatabaseBlock';
import { DatabasePicker } from '@/components/notes/DatabasePicker';
import { createInlineDatabase } from '@/lib/inlineDatabase';
import { toast } from 'sonner';
import { TableBlock } from '@/components/notes/TableBlock';
import { computeNumberedOrdinals, hiddenBlockIds, levelOf, toggleHasChildren } from '@/lib/noteBlocks';

/** How far each level of Tab pushes a line in, in px. */
const INDENT_STEP = 24;
import { InlineText, supportedMarks } from '@/components/notes/InlineText';
import { activeMarks, hasInlineMarks, toggleMark, type Mark } from '@/lib/inlineMarkdown';
import { getCaretCoordinates } from '@/lib/caretCoordinates';
import {
  controlsTop, getBlockTextClass, markerBoxClass, markerTop,
} from '@/components/notes/blockMetrics';
import type { KaizenList, Quadrant, TaskLinking, Todo } from '@/types/todo';
import { MentionMenu, type MentionMenuHandle } from '@/components/notes/MentionMenu';
import { LinkedTaskChip } from '@/components/notes/LinkedTaskChip';
import {
  canMention, detectMentionTrigger, removeMentionTrigger, taskTitleFromText, type MentionTrigger,
} from '@/lib/noteMentions';

/**
 * What the editor needs to add blocks to quadrants. Tasks live in App, so it
 * passes these down; without them the "@" menu is simply off.
 */
export type NoteTaskLinking = TaskLinking<{ noteId: string; blockId: string }> & {
  /** A database block's arrow: open that database on the Databases page. */
  openDatabase?: (databaseId: string) => void;
};

// ── Block type icon map ────────────────────────────────────────────────────────
const ICON = 'size-3.5';
const STROKE = 2.75;

const BLOCK_ICONS: Record<BlockType, React.ReactNode> = {
  paragraph: <Type className={ICON} strokeWidth={STROKE} />,
  heading1:  <Heading1 className={ICON} strokeWidth={STROKE} />,
  heading2:  <Heading2 className={ICON} strokeWidth={STROKE} />,
  heading3:  <Heading3 className={ICON} strokeWidth={STROKE} />,
  bullet:    <List className={ICON} strokeWidth={STROKE} />,
  numbered:  <ListOrdered className={ICON} strokeWidth={STROKE} />,
  todo:      <CheckSquare className={ICON} strokeWidth={STROKE} />,
  quote:     <Quote className={ICON} strokeWidth={STROKE} />,
  divider:   <Minus className={ICON} strokeWidth={STROKE} />,
  code:      <Code2 className={ICON} strokeWidth={STROKE} />,
  table:     <Table2 className={ICON} strokeWidth={STROKE} />,
  callout:   <Lightbulb className={ICON} strokeWidth={STROKE} />,
  database:  <Table2 className={ICON} strokeWidth={STROKE} />,
  toggle:    <ChevronRight className={ICON} strokeWidth={STROKE} />,
};

const BLOCK_TYPES: BlockType[] = [
  'paragraph', 'heading1', 'heading2', 'heading3',
  'bullet', 'numbered', 'todo', 'toggle', 'quote', 'callout', 'divider', 'code', 'table',
];

// ── Spacing ────────────────────────────────────────────────────────────────────
// Blocks sit in a flex column with a 6px gap; extra space is margin, never row
// padding, so the space above a heading doesn't depend on the block before it.
// The type scale and every offset derived from it live in notes/blockMetrics.
const ROW_SPACING: Partial<Record<BlockType, string>> = {
  // Showcase 316, 335: a heading has 14px above and 4px below, on top of the 6px gap.
  heading1: 'mt-[14px] mb-[4px]',
  heading2: 'mt-[14px] mb-[4px]',
  heading3: 'mt-[14px] mb-[4px]',
  // A to-do is a py-1 row (showcase 321).
  todo:     'py-[4px]',
  quote:    'my-[12px]',
  code:     'my-[10px]',
  // Showcase 357: 18px above, 10px below the inline database, on top of the 6px gap.
  database: 'mt-[12px] mb-[4px]',
  callout:  'my-[10px]',
  // With the gap and the 24px box, 26px of space either side of the rule.
  divider:  'my-[8px]',
  // With the gap, 24px below the table: room for its add-row rail (4px + 20px).
  table:    'my-[8px]',
};

/** The quote rule, the code panel and the callout tint wrap the text itself. */
function getContentWrapperClass(block: NoteBlock): string {
  switch (block.type) {
    case 'quote':   return 'border-l-[3px] border-a-line-strong py-[2px] pl-4';
    case 'code':    return 'rounded-[8px] bg-a-ink px-4 py-[14px]';
    // The prototype's callout is grey; the sage tone stays as the one alternative.
    case 'callout': return cn('rounded-[8px] px-4 py-3', block.tone === 'sage' ? 'bg-a-sage-tint' : 'bg-a-line-soft');
    default:        return '';
  }
}

function getBlockPlaceholder(type: BlockType): string {
  switch (type) {
    case 'heading1': return 'Heading 1';
    case 'heading2': return 'Heading 2';
    case 'heading3': return 'Heading 3';
    case 'quote':    return 'Quote…';
    case 'code':     return '// Code…';
    case 'bullet':   return 'List item';
    case 'numbered': return 'List item';
    case 'todo':     return 'To-do';
    case 'callout':  return 'Callout…';
    case 'toggle':   return 'Toggle';
    default:         return 'Type "/" for blocks, "@" to add a line to a quadrant';
  }
}

/** Block types whose pasted lines can be made into one block each. */
const SPLITTABLE: ReadonlySet<BlockType> = new Set<BlockType>(['paragraph', 'bullet', 'numbered', 'todo', 'toggle']);

// ── Inline formatting toolbar ──────────────────────────────────────────────────
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const MARK_BUTTONS: Array<{ mark: Mark; label: string; shortcut: string; icon: React.ReactNode }> = [
  { mark: 'bold',      label: 'Bold',          shortcut: `${MOD}B`,  icon: <Bold className={ICON} strokeWidth={STROKE} /> },
  { mark: 'italic',    label: 'Italic',        shortcut: `${MOD}I`,  icon: <Italic className={ICON} strokeWidth={STROKE} /> },
  { mark: 'underline', label: 'Underline',     shortcut: `${MOD}U`,  icon: <Underline className={ICON} strokeWidth={STROKE} /> },
  { mark: 'strike',    label: 'Strikethrough', shortcut: `${MOD}⇧X`, icon: <Strikethrough className={ICON} strokeWidth={STROKE} /> },
];

/**
 * Bold / italic / underline / strikethrough for the current selection.
 *
 * These buttons used to do nothing: their handler discarded the format and
 * closed the toolbar. They now apply marks, stored as delimiters in the block's
 * content — see lib/inlineMarkdown. Only marks the block type supports are
 * offered, and a mark already covering the selection shows as pressed.
 */
function InlineToolbar({ marks, active, onToggle, onSplit }: {
  marks: readonly Mark[];
  active: Set<Mark>;
  onToggle: (mark: Mark) => void;
  /** Offered when the selection spans several lines of one list item. */
  onSplit?: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex items-center gap-0.5 rounded-[12px] border border-a-line bg-a-bg p-1 shadow-[var(--a-shadow-md)]"
    >
      {MARK_BUTTONS.filter((b) => marks.includes(b.mark)).map(({ mark, label, shortcut, icon }) => (
        <button
          key={mark}
          type="button"
          title={`${label} (${shortcut})`}
          aria-label={label}
          aria-pressed={active.has(mark)}
          // mousedown, prevented: the textarea must keep focus and its selection.
          onMouseDown={(e) => { e.preventDefault(); onToggle(mark); }}
          className={cn(
            'flex size-7 items-center justify-center rounded-[8px] transition-colors duration-[120ms]',
            active.has(mark)
              ? 'bg-a-accent-tint text-a-accent-700'
              : 'text-a-muted hover:bg-a-row-hover hover:text-a-ink',
          )}
        >
          {icon}
        </button>
      ))}
      {onSplit && (
        <button
          type="button"
          title="Make each selected line its own item"
          onMouseDown={(e) => { e.preventDefault(); onSplit(); }}
          className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink"
        >
          <List className={ICON} strokeWidth={STROKE} />
          Split lines
        </button>
      )}
    </div>
  );
}

// ── Textarea auto-resize ───────────────────────────────────────────────────────
function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  /** Stacked under rendered text: fill the rendered copy instead of sizing to content. */
  overlay = false,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (overlay) {
      el.style.height = '100%';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value, overlay]);
}

// ── Gutter controls (add + options menu) ───────────────────────────────────────
interface BlockControlsProps {
  block: NoteBlock;
  index: number;
  total: number;
  onAddAfter: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeType: (id: string, type: BlockType) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

const GUTTER_BUTTON = cn(
  'flex size-7 items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms]',
  'hover:bg-[color-mix(in_srgb,var(--a-ink)_9%,transparent)] hover:text-a-ink',
  'data-[state=open]:bg-[color-mix(in_srgb,var(--a-ink)_9%,transparent)] data-[state=open]:text-a-ink',
);

function BlockControls({ block, index, total, onAddAfter, onDelete, onChangeType, onMoveUp, onMoveDown }: BlockControlsProps) {
  return (
    <>
      <button
        type="button"
        onClick={() => onAddAfter(block.id)}
        className={GUTTER_BUTTON}
        aria-label="Add block below"
        title="Add block below"
      >
        <Plus className="size-4" strokeWidth={STROKE} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={GUTTER_BUTTON}
            aria-label="Block options"
            // Not "drag to reorder": there is no drag, and the old title said there was.
            title="Move, turn into, or delete"
          >
            <GripVertical className="size-4" strokeWidth={STROKE} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {index > 0 && (
            <DropdownMenuItem onClick={() => onMoveUp(block.id)}>
              <ArrowUp className="size-3.5" /> Move up
            </DropdownMenuItem>
          )}
          {index < total - 1 && (
            <DropdownMenuItem onClick={() => onMoveDown(block.id)}>
              <ArrowDown className="size-3.5" /> Move down
            </DropdownMenuItem>
          )}
          {(index > 0 || index < total - 1) && <DropdownMenuSeparator />}

          <DropdownMenuLabel>Turn into</DropdownMenuLabel>
          {BLOCK_TYPES.filter((t) => t !== block.type).map((type) => (
            <DropdownMenuItem key={type} onClick={() => onChangeType(block.id, type)}>
              {BLOCK_ICONS[type]}
              <span>{BLOCK_TYPE_LABELS[type]}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(block.id)}>
            <Trash2 className="size-3.5" /> Delete block
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// ── Single Block Row ───────────────────────────────────────────────────────────
interface BlockRowProps {
  block: NoteBlock;
  index: number;
  /** For numbered blocks: its position within its own list run. */
  ordinal?: number;
  /** The block above is the same kind of list item: a list has no space between its items (showcase 344). */
  joinPrev?: boolean;
  total: number;
  focusedId: string | null;
  onFocus: (id: string) => void;
  onChange: (id: string, content: string) => void;
  onToggleCheck: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>, id: string) => void;
  onAddAfter: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeType: (id: string, type: BlockType) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onUpdateTable: (id: string, tableData: TableData) => void;
  textareaRef: (el: HTMLTextAreaElement | null, id: string) => void;
  onSlashOpen: (blockId: string, pos: { top: number; left: number }) => void;
  /** The textarea's selection may have changed; re-evaluate the format toolbar. */
  onSelectionChange: (id: string) => void;
  /** Non-content fields, such as a callout's emoji and tone. */
  onUpdateMeta: (id: string, changes: Partial<Pick<NoteBlock, 'emoji' | 'tone' | 'collapsed'>>) => void;
  /** The caret or text moved: open, update or close the "@" menu. */
  onMentionCheck: (id: string, el: HTMLTextAreaElement) => void;
  /** The linked-task chip, when this block is in a quadrant. */
  chip?: React.ReactNode;
  /** A database block's arrow. */
  onOpenDatabase?: (databaseId: string) => void;
  /** The task this line became is done: the line reads as finished too, so the note does not go stale. */
  linkedDone?: boolean;
}

/**
 * One block. Its controls hang in the left margin, outside the row's box, so
 * the row's left edge is the text's left edge for every block type.
 *
 * No chrome until the pointer is on the row, and hovering paints nothing: it
 * only reveals the two controls. A tinted hover slab used to span the gutter
 * too, and the 46px of controls overflowed the 44px gutter, leaving the "+"
 * half inside the tint and half outside.
 *
 * Below `md` there is no margin, so the controls are hidden.
 */
function BlockRow({
  block, index, ordinal, joinPrev, total, focusedId,
  onFocus, onChange, onToggleCheck, onKeyDown,
  onAddAfter, onDelete, onChangeType, onMoveUp, onMoveDown,
  onUpdateTable, textareaRef, onSlashOpen, onSelectionChange, onUpdateMeta,
  onMentionCheck, chip, onOpenDatabase, linkedDone,
}: BlockRowProps) {
  const [hovered, setHovered] = useState(false);
  const isFocused = focusedId === block.id;
  const showControls = hovered || isFocused;
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Formatted text is shown rendered while the block is not being edited, and
  // as raw text with its delimiters while it is. Blocks with no marks never
  // swap: for them the textarea is all there is, exactly as before.
  const rendered = !isFocused && supportedMarks(block.type).length > 0 && hasInlineMarks(block.content);

  useAutoResize(taRef, block.content, rendered);

  // `pr-1.5` rather than a margin: the 6px between the grip and the text is part
  // of the controls' box, so crossing it doesn't count as leaving the row.
  // A database block can start left of the reading column; its controls follow it.
  const [shift, setShift] = useState(0);
  const gutter = (
    <div
      className={cn(
        'absolute right-full z-10 hidden gap-[2px] pr-3.5 select-none transition-opacity duration-[120ms] md:flex',
        // Also kept visible while a control has keyboard focus or its menu is open.
        showControls ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
      )}
      style={{ top: controlsTop(block.type), ...(shift ? { transform: `translateX(${shift}px)` } : {}) }}
    >
      <BlockControls
        block={block} index={index} total={total}
        onAddAfter={onAddAfter} onDelete={onDelete}
        onChangeType={onChangeType} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
      />
    </div>
  );

  const rowProps = {
    className: cn(
      'relative flex',
      // An invisible hover zone over the margin beside the row, so pointing at
      // the empty margin reveals the controls as it does in Notion.
      "md:before:absolute md:before:inset-y-0 md:before:right-full md:before:w-[var(--a-gutter)] md:before:content-['']",
      ROW_SPACING[block.type],
      joinPrev && '-mt-[6px]',
    ),
    // Pushed in with Tab: the whole row (marker, text and its hover controls) moves, as in an outline.
    ...(levelOf(block) > 0 ? { style: { marginLeft: levelOf(block) * INDENT_STEP } } : {}),
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  const textClass = cn(
    getBlockTextClass(block.type),
    (block.type === 'todo' && block.checked || linkedDone) && 'text-a-faint line-through decoration-[1.5px]',
    // Callout text on its tint: accent-700 and sage-ink both clear 4.5:1.
    block.type === 'callout' && (block.tone === 'sage' ? 'text-a-sage-ink' : 'text-a-ink'),
  );

  // ── Divider ──────────────────────────────────────────────────────────────────
  if (block.type === 'divider') {
    return (
      <div {...rowProps}>
        {gutter}
        <div className="flex h-[24px] flex-1 items-center">
          <hr className="h-px w-full border-0 bg-a-line" />
        </div>
      </div>
    );
  }

  // ── Database ─────────────────────────────────────────────────────────────────
  if (block.type === 'database') {
    return (
      <div {...rowProps}>
        {gutter}
        <div className="min-w-0 flex-1">
          {block.databaseId
            ? <DatabaseBlock databaseId={block.databaseId} layout={block.dbLayout} onOpenDatabase={onOpenDatabase} onShift={setShift} />
            : <div className="rounded-[8px] border border-dashed border-a-line-strong px-4 py-3 text-[13px] text-a-faint">Choosing a database…</div>}
        </div>
      </div>
    );
  }

  // ── Table ────────────────────────────────────────────────────────────────────
  if (block.type === 'table') {
    return (
      <div {...rowProps}>
        {gutter}
        <div className="min-w-0 flex-1">
          <TableBlock
            block={block}
            isFocused={isFocused}
            onUpdateTable={(td) => onUpdateTable(block.id, td)}
            onFocus={onFocus}
          />
        </div>
      </div>
    );
  }

  // ── Text-based blocks ────────────────────────────────────────────────────────
  return (
    <div {...rowProps}>
      {gutter}

      <div className={cn('flex min-w-0 flex-1 items-start', getContentWrapperClass(block))}>
        {block.type === 'callout' && (
          <span className={markerBoxClass('callout')} style={{ paddingTop: markerTop('callout', 18) }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-[18px] items-center justify-center rounded-[4px] text-[18px] leading-none transition-transform duration-[120ms] hover:scale-110"
                aria-label="Change callout emoji and colour"
              >
                {/* The default 💡 is the prototype's line lightbulb (showcase 349); any other emoji shows as chosen. */}
                {(block.emoji ?? '💡') === '💡' ? <Lightbulb className="size-[18px]" strokeWidth={1.75} aria-hidden /> : block.emoji}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <div className="grid grid-cols-6 gap-1 p-1">
                {NOTE_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => onUpdateMeta(block.id, { emoji: em })}
                    aria-label={`Use ${em}`}
                    className={cn(
                      'rounded-[8px] p-1.5 text-center text-lg transition-colors duration-[120ms] hover:bg-accent',
                      (block.emoji ?? '💡') === em && 'bg-accent',
                    )}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Colour</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={block.tone ?? 'accent'}
                onValueChange={(v) => onUpdateMeta(block.id, { tone: v as CalloutTone })}
              >
                <DropdownMenuRadioItem value="accent">Terracotta</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="sage">Sage</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          </span>
        )}

        {block.type === 'toggle' && (
          <span className={markerBoxClass('toggle')} style={{ paddingTop: markerTop('toggle', 20) }}>
            <button
              type="button"
              aria-expanded={!block.collapsed}
              aria-label={block.collapsed ? 'Open toggle' : 'Close toggle'}
              onClick={() => onUpdateMeta(block.id, { collapsed: !block.collapsed })}
              className="flex size-5 items-center justify-center rounded-[4px] text-a-ink transition-colors duration-[120ms] hover:bg-a-line-soft"
            >
              <svg viewBox="0 0 10 10" aria-hidden className={cn('size-[9px] transition-transform duration-[120ms]', block.collapsed && '-rotate-90')}>
                <polygon points="1,2.5 9,2.5 5,8.5" fill="currentColor" />
              </svg>
            </button>
          </span>
        )}

        {block.type === 'bullet' && (
          <span aria-hidden className={markerBoxClass('bullet')} style={{ paddingTop: markerTop('bullet', 5) }}>
            <span className="size-[5px] rounded-full bg-a-muted" />
          </span>
        )}

        {block.type === 'numbered' && (
          <span
            aria-hidden
            className={cn(markerBoxClass('numbered'), 'text-[14px] leading-[1.8] tabular-nums text-a-muted')}
          >
            {ordinal ?? 1}.
          </span>
        )}

        {block.type === 'todo' && (
          // The DS Checkbox (showcase 323): a 16px box in an 18px column.
          <span className={markerBoxClass('todo')} style={{ paddingTop: markerTop('todo', 16) }}>
            <button
              type="button"
              role="checkbox"
              aria-checked={!!block.checked}
              aria-label={block.content.trim() || 'To-do'}
              onClick={() => onToggleCheck(block.id)}
              className={cn(
                'flex size-4 items-center justify-center rounded-[3px] border-[1.5px] text-white transition-colors duration-[120ms]',
                block.checked ? 'border-a-accent bg-a-accent' : 'border-a-line-strong bg-a-surface',
              )}
            >
              {block.checked && <Check className="size-3" strokeWidth={1.75} aria-hidden />}
            </button>
          </span>
        )}

        {/* With a chip, the text is only as wide as it is, so the chip follows it (showcase 327). */}
        <div className={cn('relative min-w-0', chip ? 'flex-initial' : 'flex-1')}>
        {/* The textarea stays mounted underneath the rendered copy the whole
            time, so it keeps its place in the tab order; focusing it — by Tab
            or by clicking the rendered text — swaps back to raw editing. */}
        {rendered && (
          <InlineText
            text={block.content}
            className={textClass}
            onActivate={(offset) => {
              const el = taRef.current;
              if (!el) return;
              el.focus();
              el.setSelectionRange(offset, offset);
            }}
          />
        )}
        <textarea
          ref={(el) => {
            taRef.current = el;
            textareaRef(el, block.id);
          }}
          value={block.content}
          onChange={(e) => {
            const val = e.target.value;
            onChange(block.id, val);

            const slashIdx = val.lastIndexOf('/');
            const textBeforeSlash = val.slice(0, slashIdx);
            const isSlashTrigger = val === '/' || (slashIdx !== -1 && textBeforeSlash.trim() === '');

            if (isSlashTrigger && taRef.current) {
              try {
                const coords = getCaretCoordinates(taRef.current, slashIdx);
                onSlashOpen(block.id, { top: coords.top + 22, left: coords.left });
              } catch {
                const rect = taRef.current.getBoundingClientRect();
                onSlashOpen(block.id, { top: rect.bottom + 4, left: rect.left });
              }
            }
            if (taRef.current) onMentionCheck(block.id, taRef.current);
          }}
          onKeyDown={(e) => onKeyDown(e, block.id)}
          onFocus={() => onFocus(block.id)}
          // Textarea selections do not reliably fire document `selectionchange`,
          // so the toolbar listens to the textarea itself.
          onSelect={() => onSelectionChange(block.id)}
          onMouseUp={() => onSelectionChange(block.id)}
          onKeyUp={(e) => {
            onSelectionChange(block.id);
            // Moving the caret out of an "@query" closes the menu.
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && taRef.current) {
              onMentionCheck(block.id, taRef.current);
            }
          }}
          onBlur={() => onSelectionChange(block.id)}
          // The paragraph hint only where typing is about to happen, not on every
          // empty line of the page. Structural placeholders always show.
          placeholder={
            block.type !== 'paragraph' || isFocused || index === total - 1
              ? getBlockPlaceholder(block.type)
              : ''
          }
          rows={1}
          className={cn(
            'block resize-none overflow-hidden border-none bg-transparent p-0 outline-none [overflow-wrap:anywhere]',
            chip ? 'field-sizing-content max-w-full' : 'w-full',
            'placeholder:text-a-line-strong',
            textClass,
            rendered && 'pointer-events-none absolute inset-0 opacity-0',
          )}
          style={{ height: 'auto' }}
          aria-label={`Block ${index + 1}: ${BLOCK_TYPE_LABELS[block.type] ?? 'Text'}`}
          spellCheck
        />
        </div>

        {chip && (
          // 22px chip, centred on the first line like the markers.
          <span className="ml-[10px] flex flex-shrink-0" style={{ paddingTop: markerTop(block.type, 22) }}>
            {chip}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main NoteEditor ────────────────────────────────────────────────────────────
interface NoteEditorProps {
  blocks: NoteBlock[];
  onUpdateBlock: (blockId: string, changes: Partial<NoteBlock>) => void;
  onAddBlock: (afterBlockId: string, type?: BlockType) => string;
  onDeleteBlock: (blockId: string) => void;
  onChangeBlockType: (blockId: string, type: BlockType) => void;
  onMoveBlock: (blockId: string, direction: 'up' | 'down') => void;
  /** Tab / Shift+Tab: push a line in or bring it back out one level (its children go with it). */
  onSetIndent?: (blockId: string, direction: 'in' | 'out') => void;
  /** The note these blocks belong to; needed to link a block to a task. */
  noteId?: string;
  linking?: NoteTaskLinking;
}

export function NoteEditor({
  blocks,
  onUpdateBlock,
  onAddBlock,
  onDeleteBlock,
  onChangeBlockType,
  onMoveBlock,
  onSetIndent,
  noteId,
  linking,
}: NoteEditorProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<{
    blockId: string;
    x: number;
    y: number;
    marks: readonly Mark[];
    active: Set<Mark>;
    canSplit: boolean;
  } | null>(null);
  const [slashState, setSlashState] = useState<{
    blockId: string;
    query: string;
    position: { top: number; left: number };
    selectedIndex: number;
  } | null>(null);

  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const pendingFocusId = useRef<string | null>(null);
  // A selection to restore once a formatting edit has re-rendered its block.
  const pendingSelection = useRef<{ id: string; start: number; end: number } | null>(null);

  // ── "@" → Add to quadrant ──
  const [mention, setMention] = useState<{
    blockId: string;
    trigger: MentionTrigger;
    position: { top: number; left: number };
    message: string | null;
  } | null>(null);
  const mentionRef = useRef<MentionMenuHandle>(null);
  // Blocks whose task is being created; they show a pending chip.
  const [pendingLinks, setPendingLinks] = useState<ReadonlySet<string>>(new Set());
  const blocksRef = useRef(blocks);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  const todosById = useMemo(
    () => new Map((linking?.todos ?? []).map((t) => [t.id, t])),
    [linking?.todos],
  );

  // Numbered lists count within their own run. Computed once here rather than
  // per row, because a row alone cannot see where its list started.
  const numberedOrdinals = useMemo(() => computeNumberedOrdinals(blocks), [blocks]);
  const hiddenIds = useMemo(() => hiddenBlockIds(blocks), [blocks]);

  const registerRef = useCallback((el: HTMLTextAreaElement | null, id: string) => {
    if (el) textareaRefs.current.set(id, el);
    else textareaRefs.current.delete(id);
  }, []);

  // Focus pending block after render
  useEffect(() => {
    if (pendingFocusId.current) {
      const el = textareaRefs.current.get(pendingFocusId.current);
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
        pendingFocusId.current = null;
      }
    }
    if (pendingSelection.current) {
      const { id, start, end } = pendingSelection.current;
      const el = textareaRefs.current.get(id);
      if (el) {
        el.setSelectionRange(start, end);
        pendingSelection.current = null;
      }
    }
  });

  // ── Formatting toolbar ──
  // Shown for a non-empty selection inside a block type that takes marks.
  const handleSelectionChange = useCallback((blockId: string) => {
    const el = textareaRefs.current.get(blockId);
    const block = blocks.find((b) => b.id === blockId);
    const marks = block ? supportedMarks(block.type) : [];
    if (
      !el || !block || marks.length === 0 ||
      document.activeElement !== el ||
      el.selectionStart === el.selectionEnd
    ) {
      setToolbar((t) => (t === null ? t : null));
      return;
    }
    try {
      const start = getCaretCoordinates(el, el.selectionStart);
      const end = getCaretCoordinates(el, el.selectionEnd);
      const sameLine = Math.abs(start.top - end.top) < 4;
      setToolbar({
        blockId,
        x: sameLine ? (start.left + end.left) / 2 : start.left,
        y: start.top - 8,
        marks,
        active: activeMarks(el.value, el.selectionStart, el.selectionEnd),
        canSplit: SPLITTABLE.has(block.type) && el.value.slice(el.selectionStart, el.selectionEnd).includes('\n'),
      });
    } catch {
      setToolbar(null);
    }
  }, [blocks]);

  // Fixed to the viewport, the toolbar would drift off its selection on scroll.
  useEffect(() => {
    if (!toolbar) return;
    const hide = () => setToolbar(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [toolbar]);

  // Close slash menu on outside click
  useEffect(() => {
    if (!slashState) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-slash-menu]')) setSlashState(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [slashState]);

  // Close the "@" menu on a click outside it.
  useEffect(() => {
    if (!mention) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-mention-menu]')) setMention(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mention]);

  const handleMentionCheck = useCallback((blockId: string, el: HTMLTextAreaElement) => {
    const block = blocks.find((b) => b.id === blockId);
    const trigger = linking && noteId && block && canMention(block.type) && !block.taskId && !pendingLinks.has(blockId)
      ? detectMentionTrigger(el.value, el.selectionStart)
      : null;

    if (!trigger) {
      setMention((m) => (m && m.blockId === blockId ? null : m));
      return;
    }

    // Nothing to make a task from yet: say so instead of offering the menu.
    const message = taskTitleFromText(removeMentionTrigger(el.value, trigger).content)
      ? null
      : 'Write the task in this block first, then type @';

    setMention((m) => {
      // Same "@", still typing: keep the menu where it is.
      if (m && m.blockId === blockId && m.trigger.at === trigger.at) return { ...m, trigger, message };
      let position: { top: number; left: number };
      try {
        const coords = getCaretCoordinates(el, trigger.at);
        position = { top: coords.top + 22, left: coords.left };
      } catch {
        const rect = el.getBoundingClientRect();
        position = { top: rect.bottom + 4, left: rect.left };
      }
      return { blockId, trigger, position, message };
    });
  }, [blocks, linking, noteId, pendingLinks]);

  const handleMentionSelect = useCallback(async (listId: string, quadrant: Quadrant, assignee?: import('@/types/todo').TaskAssignee) => {
    if (!mention || !linking || !noteId) return;
    const { blockId, trigger } = mention;
    const block = blocks.find((b) => b.id === blockId);
    if (!block) { setMention(null); return; }

    const original = textareaRefs.current.get(blockId)?.value ?? block.content;
    const { content, caret } = removeMentionTrigger(original, trigger);
    const title = taskTitleFromText(content);
    if (!title) {
      setMention((m) => (m ? { ...m, message: 'Write the task in this block first, then type @' } : m));
      return;
    }

    setMention(null);
    setPendingLinks((prev) => new Set(prev).add(blockId));
    onUpdateBlock(blockId, { content });
    pendingSelection.current = { id: blockId, start: caret, end: caret };

    const task = await linking.createTask({ listId, quadrant, title, noteId, blockId, ...(assignee ? { assignee } : {}) });

    setPendingLinks((prev) => {
      const next = new Set(prev);
      next.delete(blockId);
      return next;
    });

    if (task) {
      onUpdateBlock(blockId, { taskId: task.id });
    } else {
      // Put the "@query" back — but only if the block hasn't been edited
      // meanwhile, so a failure never overwrites newer typing.
      const current = blocksRef.current.find((b) => b.id === blockId);
      if (current && current.content === content) onUpdateBlock(blockId, { content: original });
    }
  }, [mention, linking, noteId, blocks, onUpdateBlock]);

  const handleSlashOpen = useCallback((blockId: string, pos: { top: number; left: number }) => {
    setSlashState((current) => current?.blockId === blockId
      ? { ...current, position: pos }
      : { blockId, query: '', position: pos, selectedIndex: 0 });
  }, []);

  /** Where the linked-database picker hangs, and which block it is for. */
  const [dbPicker, setDbPicker] = useState<{ blockId: string; position: { top: number; left: number } } | null>(null);

  /** A block becomes a database block pointing at `databaseId`. */
  const attachDatabase = useCallback((blockId: string, databaseId: string, layout: 'table' | 'board') => {
    onChangeBlockType(blockId, 'database');
    onUpdateBlock(blockId, { content: '', databaseId, dbLayout: layout });
  }, [onChangeBlockType, onUpdateBlock]);

  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    if (!slashState) return;
    const { blockId, position } = slashState;
    setSlashState(null);
    if (cmd.action === 'db-linked') {
      onUpdateBlock(blockId, { content: '' });
      setDbPicker({ blockId, position });
      return;
    }
    if (cmd.action) {
      // A new database, made now: a block that names one that was never made would be a promise.
      const layout = cmd.action === 'db-board' ? 'board' : 'table';
      onUpdateBlock(blockId, { content: '' });
      void createInlineDatabase(layout)
        .then((db) => attachDatabase(blockId, db.id, layout))
        .catch(() => toast.error("Couldn't create the database"));
      return;
    }
    onChangeBlockType(blockId, cmd.type);
    onUpdateBlock(blockId, { content: '' });
    pendingFocusId.current = blockId;
  }, [slashState, onChangeBlockType, onUpdateBlock, attachDatabase]);

  const handleChange = useCallback((blockId: string, content: string) => {
    if (slashState && slashState.blockId === blockId) {
      const slashIdx = content.lastIndexOf('/');
      if (slashIdx !== -1) {
        const query = content.slice(slashIdx + 1).toLowerCase();
        setSlashState((s) => s ? { ...s, query, selectedIndex: 0 } : null);
      } else {
        setSlashState(null);
      }
    }
    onUpdateBlock(blockId, { content });

    // A linked block's text is its task's title. App debounces the write.
    const taskId = blocks.find((b) => b.id === blockId)?.taskId;
    if (taskId && linking) {
      const title = taskTitleFromText(content);
      // A cleared block keeps the task's last title rather than blanking it.
      if (title) linking.updateTaskTitle(taskId, title);
    }
  }, [slashState, onUpdateBlock, blocks, linking]);

  const handleToggleCheck = useCallback((blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (block) onUpdateBlock(blockId, { checked: !block.checked });
  }, [blocks, onUpdateBlock]);

  const handleUpdateTable = useCallback((blockId: string, tableData: TableData) => {
    onUpdateBlock(blockId, { tableData });
  }, [onUpdateBlock]);

  const handleToggleMark = useCallback((blockId: string, mark: Mark) => {
    const el = textareaRefs.current.get(blockId);
    const block = blocks.find((b) => b.id === blockId);
    if (!el || !block || !supportedMarks(block.type).includes(mark)) return;

    const next = toggleMark(el.value, el.selectionStart, el.selectionEnd, mark);
    if (next.content === el.value) return;

    // Keep the same visible text selected after the edit, so pressing the
    // button again undoes it.
    pendingSelection.current = { id: blockId, start: next.selStart, end: next.selEnd };
    onUpdateBlock(blockId, { content: next.content });
    setToolbar((t) => (t && t.blockId === blockId
      ? { ...t, active: activeMarks(next.content, next.selStart, next.selEnd) }
      : t));
  }, [blocks, onUpdateBlock]);

  // A paste lands as one block with line breaks in it. This turns each selected line into its own block of the
  // same type, so the pasted text does not have to be cut apart by hand.
  const handleSplitLines = useCallback((blockId: string) => {
    const el = textareaRefs.current.get(blockId);
    const block = blocks.find((b) => b.id === blockId);
    if (!el || !block || !SPLITTABLE.has(block.type)) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const lines = value.slice(start, end).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    const before = value.slice(0, start);
    const after = value.slice(end);

    onUpdateBlock(blockId, { content: before + lines[0] });
    let prevId = blockId;
    // A new line after an open toggle goes inside it; the items made here are siblings, so they come back out.
    const idx = blocks.findIndex((b) => b.id === blockId);
    lines.slice(1).forEach((line, i) => {
      const newId = onAddBlock(prevId, block.type);
      const insideOpenToggle = block.type === 'toggle'
        && (i > 0 || (!block.collapsed && !toggleHasChildren(blocks, idx)));
      if (insideOpenToggle && onSetIndent) onSetIndent(newId, 'out');
      onUpdateBlock(newId, { content: i === lines.length - 2 ? line + after : line });
      prevId = newId;
    });
    setToolbar(null);
    pendingFocusId.current = prevId;
  }, [blocks, onAddBlock, onUpdateBlock, onSetIndent]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>, blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    const idx = blocks.findIndex((b) => b.id === blockId);
    const el = textareaRefs.current.get(blockId);
    const cursorAtStart = el?.selectionStart === 0 && el?.selectionEnd === 0;
    const cursorAtEnd = el && el.selectionStart === el.value.length;

    // Formatting shortcuts, only in block types that take marks — so ⌘B inside
    // a code block is left alone.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const mark: Mark | null =
        key === 'b' && !e.shiftKey ? 'bold'
        : key === 'i' && !e.shiftKey ? 'italic'
        : key === 'u' && !e.shiftKey ? 'underline'
        : key === 'x' && e.shiftKey ? 'strike'
        : null;
      if (mark && supportedMarks(block.type).includes(mark)) {
        e.preventDefault();
        handleToggleMark(blockId, mark);
        return;
      }
    }

    // "@" menu navigation. Keys it doesn't use fall through, so ← at the
    // first column still moves the caret (and so closes the menu).
    if (mention && mention.blockId === blockId && mentionRef.current) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        if (mentionRef.current.handleKey(e.key)) {
          e.preventDefault();
          return;
        }
      }
    }

    // Slash menu navigation
    if (slashState && slashState.blockId === blockId) {
      // The same list the menu renders, so ↵ picks the highlighted command.
      const filtered = filterSlashCommands(slashState.query);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashState((s) => s ? { ...s, selectedIndex: Math.min(s.selectedIndex + 1, filtered.length - 1) } : null);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashState((s) => s ? { ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) } : null);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = filtered[slashState.selectedIndex];
        if (cmd) handleSlashSelect(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashState(null);
        return;
      }
    }

    const isListItem = block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo';
    // The line above or below that is actually shown (lines inside a closed toggle are not).
    const hidden = hiddenBlockIds(blocks);
    const visibleNeighbour = (direction: -1 | 1) => {
      let k = idx + direction;
      while (blocks[k] && hidden.has(blocks[k].id)) k += direction;
      return blocks[k];
    };

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && block.type === 'toggle') {
      // ⌘/Ctrl+↵ opens or closes a toggle without leaving the line.
      e.preventDefault();
      onUpdateBlock(blockId, { collapsed: !block.collapsed });
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // A toggle is never ended by Enter, even when empty: it adds the next toggle (Backspace removes an empty one).
      if (isListItem && block.content === '') {
        // An empty list item ends the list: one level back out when it is nested, otherwise plain text.
        if (levelOf(block) > 0 && onSetIndent) onSetIndent(blockId, 'out');
        else onChangeBlockType(blockId, 'paragraph');
        pendingFocusId.current = blockId;
        return;
      }
      // A list item or a toggle continues as the same kind. A toggle with nothing inside gets a sibling toggle
      // (level with it), not one nested inside it, so repeated Enter builds a row of toggles rather than a staircase.
      const nextType: BlockType = isListItem || block.type === 'toggle' ? block.type : 'paragraph';
      const newId = onAddBlock(blockId, nextType);
      if (block.type === 'toggle' && !block.collapsed && !toggleHasChildren(blocks, idx) && onSetIndent) {
        onSetIndent(newId, 'out');
      }
      pendingFocusId.current = newId;
    } else if (e.key === 'Backspace' && cursorAtStart && levelOf(block) > 0 && onSetIndent) {
      // Backspace at the start of a pushed-in line first brings it back out; only a top-level empty line is deleted.
      e.preventDefault();
      onSetIndent(blockId, 'out');
      pendingFocusId.current = blockId;
    } else if (e.key === 'Backspace' && cursorAtStart && block.content === '') {
      e.preventDefault();
      if (blocks.length > 1) {
        onDeleteBlock(blockId);
        const prevBlock = visibleNeighbour(-1) ?? visibleNeighbour(1);
        if (prevBlock) pendingFocusId.current = prevBlock.id;
      }
    } else if (e.key === 'ArrowUp' && cursorAtStart) {
      const prev = visibleNeighbour(-1);
      if (prev) { e.preventDefault(); pendingFocusId.current = prev.id; }
    } else if (e.key === 'ArrowDown' && cursorAtEnd) {
      const next = visibleNeighbour(1);
      if (next) { e.preventDefault(); pendingFocusId.current = next.id; }
    } else if (e.key === 'Tab' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (block.type === 'code') {
        // Code keeps real spacing: Tab adds two spaces, Shift+Tab takes up to two from the start of the line.
        onUpdateBlock(blockId, { content: e.shiftKey ? block.content.replace(/^ {1,2}/, '') : block.content + '  ' });
      } else if (onSetIndent) {
        onSetIndent(blockId, e.shiftKey ? 'out' : 'in');
        pendingFocusId.current = blockId;
      }
    }
  }, [blocks, slashState, mention, onAddBlock, onDeleteBlock, onUpdateBlock, onSetIndent, onChangeBlockType, handleSlashSelect, handleToggleMark]);

  const handleAddAfter = useCallback((blockId: string) => {
    const newId = onAddBlock(blockId, 'paragraph');
    pendingFocusId.current = newId;
  }, [onAddBlock]);

  // Deleting a linked block must also unlink its task — otherwise the task is
  // left pointing at a note/block that no longer exists, same cleanup the
  // LinkedTaskChip's own "unlink" action does.
  const handleDeleteBlock = useCallback((blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (block?.taskId) linking?.unlinkTask(block.taskId);
    onDeleteBlock(blockId);
  }, [blocks, linking, onDeleteBlock]);


  return (
    <div className="relative">
      {/* Inline toolbar */}
      {toolbar && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full animate-fade-in"
          style={{ left: toolbar.x, top: toolbar.y }}
        >
          <InlineToolbar
            marks={toolbar.marks}
            active={toolbar.active}
            onToggle={(mark) => handleToggleMark(toolbar.blockId, mark)}
            onSplit={toolbar.canSplit ? () => handleSplitLines(toolbar.blockId) : undefined}
          />
        </div>
      )}

      {/* Slash command menu */}
      {slashState && (
        <SlashMenu
          query={slashState.query}
          position={slashState.position}
          onSelect={handleSlashSelect}
          onClose={() => setSlashState(null)}
          selectedIndex={slashState.selectedIndex}
        />
      )}

      {dbPicker && (
        <DatabasePicker
          position={dbPicker.position}
          onClose={() => setDbPicker(null)}
          onPick={(db) => { attachDatabase(dbPicker.blockId, db.id, 'table'); setDbPicker(null); }}
        />
      )}

      {/* "@" → Add to quadrant */}
      {mention && linking && (
        <MentionMenu
          ref={mentionRef}
          position={mention.position}
          lists={linking.lists}
          preferredListId={linking.preferredListId}
          query={mention.trigger.query}
          pending={false}
          message={mention.message}
          contextLabel="Note block"
          onSelect={(listId, quadrant, assignee) => { void handleMentionSelect(listId, quadrant, assignee); }}
          onClose={() => setMention(null)}
        />
      )}

      {/* Blocks */}
      <div className="flex flex-col gap-[6px]">
        {blocks.map((block, index) => hiddenIds.has(block.id) ? null : (
          <Fragment key={block.id}>
          <BlockRow
            block={block}
            index={index}
            ordinal={numberedOrdinals.get(block.id)}
            joinPrev={index > 0 && (block.type === 'bullet' || block.type === 'numbered') && blocks[index - 1].type === block.type}
            total={blocks.length}
            focusedId={focusedId}
            onFocus={setFocusedId}
            onChange={handleChange}
            onToggleCheck={handleToggleCheck}
            onKeyDown={handleKeyDown}
            onAddAfter={handleAddAfter}
            onDelete={handleDeleteBlock}
            onChangeType={onChangeBlockType}
            onMoveUp={(id) => onMoveBlock(id, 'up')}
            onMoveDown={(id) => onMoveBlock(id, 'down')}
            onUpdateTable={handleUpdateTable}
            textareaRef={registerRef}
            onSlashOpen={handleSlashOpen}
            onSelectionChange={handleSelectionChange}
            onUpdateMeta={onUpdateBlock}
            onMentionCheck={handleMentionCheck}
            onOpenDatabase={linking?.openDatabase}
            linkedDone={!!block.taskId && todosById.get(block.taskId)?.status === 'done'}
            chip={
              linking && linking.tasksLoaded && (block.taskId || pendingLinks.has(block.id)) ? (
                <LinkedTaskChip
                  task={block.taskId ? todosById.get(block.taskId) : undefined}
                  lists={linking.lists}
                  pending={pendingLinks.has(block.id)}
                  onOpen={linking.openTask}
                  onUnlink={() => {
                    const taskId = block.taskId;
                    onUpdateBlock(block.id, { taskId: undefined });
                    if (taskId) linking.unlinkTask(taskId);
                  }}
                />
              ) : undefined
            }
          />
          {block.type === 'toggle' && !block.collapsed && !toggleHasChildren(blocks, index) && (
            <button
              type="button"
              onClick={() => handleAddAfter(block.id)}
              style={{ marginLeft: (levelOf(block) + 1) * INDENT_STEP + 22 }}
              className="-mt-[2px] w-fit cursor-text text-left text-[14px] leading-[1.65] text-a-faint"
            >
              Empty toggle. Click or drop blocks inside.
            </button>
          )}
          </Fragment>
        ))}
      </div>

      {/* Click-to-add area */}
      <button
        type="button"
        onClick={() => {
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock) {
            if (lastBlock.content.trim() === '' && lastBlock.type === 'paragraph') {
              pendingFocusId.current = lastBlock.id;
            } else {
              const newId = onAddBlock(lastBlock.id, 'paragraph');
              pendingFocusId.current = newId;
            }
          }
        }}
        className="mt-2 block h-16 w-full cursor-text"
        aria-label="Add new block"
      />
    </div>
  );
}

// Re-export createEmptyBlock for convenience
export { createEmptyBlock };
