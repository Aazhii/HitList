import {
  useRef, useEffect, useCallback, useState, useMemo,
  KeyboardEvent,
} from 'react';
import {
  Plus, GripVertical, Trash2, ArrowUp, ArrowDown,
  Type, Heading1, Heading2, Heading3, List, ListOrdered,
  CheckSquare, Quote, Minus, Code2, Table2, Lightbulb,
  Bold, Italic, Underline, Strikethrough,
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
import { StatusBox } from '@/components/ui/status-box';
import { SlashMenu, filterSlashCommands } from '@/components/notes/SlashMenu';
import { TableBlock } from '@/components/notes/TableBlock';
import { computeNumberedOrdinals } from '@/lib/noteBlocks';
import { InlineText, supportedMarks } from '@/components/notes/InlineText';
import { activeMarks, hasInlineMarks, toggleMark, type Mark } from '@/lib/inlineMarkdown';
import {
  MARKER_BOX_CLASS, controlsTop, getBlockTextClass, markerTop,
} from '@/components/notes/blockMetrics';
import type { KaizenList, Quadrant, Todo } from '@/types/todo';
import { MentionMenu, type MentionMenuHandle } from '@/components/notes/MentionMenu';
import { LinkedTaskChip } from '@/components/notes/LinkedTaskChip';
import {
  canMention, detectMentionTrigger, removeMentionTrigger, taskTitleFromBlock, type MentionTrigger,
} from '@/lib/noteMentions';

/**
 * What the editor needs to add blocks to quadrants. Tasks live in App, so it
 * passes these down; without them the "@" menu is simply off.
 */
export interface NoteTaskLinking {
  lists: KaizenList[];
  todos: Todo[];
  /** False until tasks have loaded, so a linked chip doesn't flash "Task removed". */
  tasksLoaded: boolean;
  preferredListId?: string;
  /** Resolves with the created task (real id), or null when it could not be saved. */
  createTask: (args: { listId: string; quadrant: Quadrant; title: string; noteId: string; blockId: string }) => Promise<Todo | null>;
  updateTaskTitle: (taskId: string, title: string) => void;
  unlinkTask: (taskId: string) => void;
  openTask: (taskId: string) => void;
}

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
};

const BLOCK_TYPES: BlockType[] = [
  'paragraph', 'heading1', 'heading2', 'heading3',
  'bullet', 'numbered', 'todo', 'quote', 'callout', 'divider', 'code', 'table',
];

// ── Spacing ────────────────────────────────────────────────────────────────────
// Blocks sit in a flex column with a 6px gap; extra space is margin, never row
// padding, so the space above a heading doesn't depend on the block before it.
// The type scale and every offset derived from it live in notes/blockMetrics.
const ROW_SPACING: Partial<Record<BlockType, string>> = {
  heading1: 'mt-[30px]',
  heading2: 'mt-[26px]',
  heading3: 'mt-[20px]',
  code:     'my-[6px]',
  callout:  'my-[2px]',
  // With the gap and the 24px box, 26px of space either side of the rule.
  divider:  'my-[8px]',
  // With the gap, 24px below the table: room for its add-row rail (4px + 20px).
  table:    'mt-[6px] mb-[18px]',
};

/** The quote rule, the code panel and the callout tint wrap the text itself. */
function getContentWrapperClass(block: NoteBlock): string {
  switch (block.type) {
    case 'quote':   return 'border-l-[3px] border-a-accent pl-5';
    case 'code':    return 'rounded-[16px] bg-a-surface-2 px-5 py-4';
    case 'callout': return cn('rounded-[18px] px-5 py-4', block.tone === 'sage' ? 'bg-a-sage-tint' : 'bg-a-accent-tint');
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
    default:         return "Type '/' for commands";
  }
}

// ── Caret position helper ──────────────────────────────────────────────────────
function getCaretCoordinates(el: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(el);

  const props = [
    'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
    'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing',
    'tabSize', 'MozTabSize',
  ] as const;

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'anywhere';

  props.forEach((prop) => {
    (mirror.style as unknown as Record<string, string>)[prop] = style[prop as keyof CSSStyleDeclaration] as string;
  });

  document.body.appendChild(mirror);
  const textBefore = el.value.substring(0, position);
  mirror.textContent = textBefore;
  const span = document.createElement('span');
  span.textContent = el.value.substring(position) || '.';
  mirror.appendChild(span);

  const elRect = el.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    top: elRect.top + (spanRect.top - mirrorRect.top),
    left: elRect.left + (spanRect.left - mirrorRect.left),
  };
}

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
function InlineToolbar({ marks, active, onToggle }: {
  marks: readonly Mark[];
  active: Set<Mark>;
  onToggle: (mark: Mark) => void;
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
            'flex size-7 items-center justify-center rounded-[8px] transition-colors duration-150',
            active.has(mark)
              ? 'bg-a-accent-tint text-a-accent-700'
              : 'text-a-muted hover:bg-a-row-hover hover:text-a-ink',
          )}
        >
          {icon}
        </button>
      ))}
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
  'flex size-[22px] items-center justify-center rounded-[7px] text-a-faint transition-colors duration-150',
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
        <Plus className="size-3.5" strokeWidth={STROKE} />
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
            <GripVertical className="size-3.5" strokeWidth={STROKE} />
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
  onUpdateMeta: (id: string, changes: Partial<Pick<NoteBlock, 'emoji' | 'tone'>>) => void;
  /** The caret or text moved: open, update or close the "@" menu. */
  onMentionCheck: (id: string, el: HTMLTextAreaElement) => void;
  /** The linked-task chip, when this block is in a quadrant. */
  chip?: React.ReactNode;
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
  block, index, ordinal, total, focusedId,
  onFocus, onChange, onToggleCheck, onKeyDown,
  onAddAfter, onDelete, onChangeType, onMoveUp, onMoveDown,
  onUpdateTable, textareaRef, onSlashOpen, onSelectionChange, onUpdateMeta,
  onMentionCheck, chip,
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
  const gutter = (
    <div
      className={cn(
        'absolute right-full z-10 hidden gap-[2px] pr-1.5 select-none transition-opacity duration-150 md:flex',
        // Also kept visible while a control has keyboard focus or its menu is open.
        showControls ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
      )}
      style={{ top: controlsTop(block.type) }}
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
      'relative flex first:mt-0',
      // An invisible hover zone over the margin beside the row, so pointing at
      // the empty margin reveals the controls as it does in Notion.
      "md:before:absolute md:before:inset-y-0 md:before:right-full md:before:w-[var(--a-gutter)] md:before:content-['']",
      ROW_SPACING[block.type],
    ),
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  const textClass = cn(
    getBlockTextClass(block.type),
    block.type === 'todo' && block.checked && 'text-a-faint line-through decoration-[1.5px]',
    // Callout text on its tint: accent-700 and sage-ink both clear 4.5:1.
    block.type === 'callout' && (block.tone === 'sage' ? 'text-a-sage-ink' : 'text-a-accent-700'),
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
          <span className={MARKER_BOX_CLASS} style={{ paddingTop: markerTop('callout', 22) }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-[22px] items-center justify-center rounded-[6px] text-[18px] leading-none transition-transform duration-150 hover:scale-110"
                aria-label="Change callout emoji and colour"
              >
                {block.emoji ?? '💡'}
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
                      'rounded-[8px] p-1.5 text-center text-lg transition-colors duration-100 hover:bg-accent',
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

        {block.type === 'bullet' && (
          <span aria-hidden className={MARKER_BOX_CLASS} style={{ paddingTop: markerTop('bullet', 6) }}>
            <span className="size-1.5 rounded-full bg-[color-mix(in_srgb,var(--a-ink)_45%,transparent)]" />
          </span>
        )}

        {block.type === 'numbered' && (
          <span
            aria-hidden
            className={cn(MARKER_BOX_CLASS, 'text-[16.5px] leading-[1.68] tabular-nums text-a-muted')}
          >
            {ordinal ?? 1}.
          </span>
        )}

        {block.type === 'todo' && (
          // The wrapper takes the 19px box's layout size; StatusBox's own padding
          // gives it a 44px hit area without pushing the text sideways.
          <span className={MARKER_BOX_CLASS} style={{ paddingTop: markerTop('todo', 19) }}>
            <StatusBox
              state={block.checked ? 'done' : 'todo'}
              label={block.content.trim() || 'To-do'}
              onClick={() => onToggleCheck(block.id)}
            />
          </span>
        )}

        <div className="relative min-w-0 flex-1">
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
            'block w-full resize-none overflow-hidden border-none bg-transparent p-0 outline-none [overflow-wrap:anywhere]',
            'placeholder:text-a-faint/55',
            textClass,
            rendered && 'pointer-events-none absolute inset-0 opacity-0',
          )}
          style={{ height: 'auto' }}
          aria-label={`Block ${index + 1}: ${BLOCK_TYPE_LABELS[block.type] ?? 'Text'}`}
          spellCheck
        />
        </div>

        {chip && (
          // 18px chip, centred on the first line like the markers.
          <span className="ml-2 flex flex-shrink-0" style={{ paddingTop: markerTop(block.type, 18) }}>
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
    const message = taskTitleFromBlock(removeMentionTrigger(el.value, trigger).content)
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

  const handleMentionSelect = useCallback(async (listId: string, quadrant: Quadrant) => {
    if (!mention || !linking || !noteId) return;
    const { blockId, trigger } = mention;
    const block = blocks.find((b) => b.id === blockId);
    if (!block) { setMention(null); return; }

    const original = textareaRefs.current.get(blockId)?.value ?? block.content;
    const { content, caret } = removeMentionTrigger(original, trigger);
    const title = taskTitleFromBlock(content);
    if (!title) {
      setMention((m) => (m ? { ...m, message: 'Write the task in this block first, then type @' } : m));
      return;
    }

    setMention(null);
    setPendingLinks((prev) => new Set(prev).add(blockId));
    onUpdateBlock(blockId, { content });
    pendingSelection.current = { id: blockId, start: caret, end: caret };

    const task = await linking.createTask({ listId, quadrant, title, noteId, blockId });

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
    setSlashState({ blockId, query: '', position: pos, selectedIndex: 0 });
  }, []);

  const handleSlashSelect = useCallback((type: BlockType) => {
    if (!slashState) return;
    onChangeBlockType(slashState.blockId, type);
    onUpdateBlock(slashState.blockId, { content: '' });
    setSlashState(null);
    pendingFocusId.current = slashState.blockId;
  }, [slashState, onChangeBlockType, onUpdateBlock]);

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
      const title = taskTitleFromBlock(content);
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
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[slashState.selectedIndex];
        if (cmd) handleSlashSelect(cmd.type);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashState(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const nextType: BlockType =
        block.type === 'bullet' || block.type === 'numbered' || block.type === 'todo'
          ? block.type
          : 'paragraph';
      const newId = onAddBlock(blockId, nextType);
      pendingFocusId.current = newId;
    } else if (e.key === 'Backspace' && cursorAtStart && block.content === '') {
      e.preventDefault();
      if (blocks.length > 1) {
        onDeleteBlock(blockId);
        const prevBlock = blocks[idx - 1] ?? blocks[idx + 1];
        if (prevBlock) pendingFocusId.current = prevBlock.id;
      }
    } else if (e.key === 'ArrowUp' && cursorAtStart) {
      const prev = blocks[idx - 1];
      if (prev) { e.preventDefault(); pendingFocusId.current = prev.id; }
    } else if (e.key === 'ArrowDown' && cursorAtEnd) {
      const next = blocks[idx + 1];
      if (next) { e.preventDefault(); pendingFocusId.current = next.id; }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (block.type === 'code') {
        onUpdateBlock(blockId, { content: block.content + '  ' });
      }
    }
  }, [blocks, slashState, mention, onAddBlock, onDeleteBlock, onUpdateBlock, handleSlashSelect, handleToggleMark]);

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
          onSelect={(listId, quadrant) => { void handleMentionSelect(listId, quadrant); }}
          onClose={() => setMention(null)}
        />
      )}

      {/* Blocks */}
      <div className="flex flex-col gap-[6px]">
        {blocks.map((block, index) => (
          <BlockRow
            key={block.id}
            block={block}
            index={index}
            ordinal={numberedOrdinals.get(block.id)}
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
        className="mt-2 w-full cursor-text py-6 text-left text-[13.5px] text-a-faint/60 transition-colors duration-200 hover:text-a-faint"
        aria-label="Add new block"
      >
        Click to add more…
      </button>
    </div>
  );
}

// Re-export createEmptyBlock for convenience
export { createEmptyBlock };
