import {
  useRef, useEffect, useCallback, useState, useMemo,
  KeyboardEvent,
} from 'react';
import {
  Plus, GripVertical, Trash2, ArrowUp, ArrowDown,
  Type, Heading1, Heading2, Heading3, List, ListOrdered,
  CheckSquare, Quote, Minus, Code2, Table2,
  Bold, Italic, Underline, Strikethrough,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteBlock, BlockType, TableData } from '@/types/notes';
import { BLOCK_TYPE_LABELS, createEmptyBlock } from '@/types/notes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { StatusBox } from '@/components/ui/status-box';
import { SlashMenu, filterSlashCommands } from '@/components/notes/SlashMenu';
import { TableBlock } from '@/components/notes/TableBlock';
import { computeNumberedOrdinals } from '@/lib/noteBlocks';

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
};

const BLOCK_TYPES: BlockType[] = [
  'paragraph', 'heading1', 'heading2', 'heading3',
  'bullet', 'numbered', 'todo', 'quote', 'divider', 'code', 'table',
];

// ── Type scale ─────────────────────────────────────────────────────────────────
// The handoff's editor scale. Body text moves from 14px to 16.5px / 1.68.
// H1 and H2 use the display face, which has a single weight — never bold it.
// Quote is no longer italic or muted: it was the least readable text on the page.
function getBlockTextClass(type: BlockType): string {
  switch (type) {
    case 'heading1': return 'font-display text-[34px] leading-[1.12] tracking-[-0.015em] text-a-ink';
    case 'heading2': return 'font-display text-[27px] leading-[1.2] tracking-[-0.01em] text-a-ink';
    case 'heading3': return 'text-[19px] leading-[1.35] font-bold text-a-ink';
    case 'quote':    return 'text-[17px] leading-[1.6] text-a-ink';
    case 'code':     return 'font-mono text-[13.5px] leading-[1.7] text-a-ink';
    default:         return 'text-[16.5px] leading-[1.68] text-a-ink';
  }
}

/** Space around each block type, per the scale. */
const ROW_SPACING: Partial<Record<BlockType, string>> = {
  heading1: 'mt-[30px] mb-[4px]',
  heading2: 'mt-[26px] mb-[4px]',
  heading3: 'mt-[20px] mb-[4px]',
  bullet:   'py-[2px]',
  numbered: 'py-[2px]',
  todo:     'py-[2px]',
  code:     'my-[6px]',
  divider:  'py-[26px]',
  table:    'py-[6px]',
};

/** The quote rule and the code panel wrap the text itself. */
function getContentWrapperClass(type: BlockType): string {
  switch (type) {
    case 'quote': return 'border-l-[3px] border-a-accent pl-5';
    case 'code':  return 'rounded-[16px] bg-a-surface-2 px-5 py-4';
    default:      return '';
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
    default:         return "Type '/' for commands…";
  }
}

// Offset of the 22px gutter controls, so their centre sits on the centre of the
// block's first line: top = lineHeight / 2 − 11.
//   heading1  34px × 1.12 = 38.1 → 19.0 − 11 = 8
//   heading2  27px × 1.20 = 32.4 → 16.2 − 11 = 5
//   heading3  19px × 1.35 = 25.7 → 12.8 − 11 = 2
//   body    16.5px × 1.68 = 27.7 → 13.9 − 11 = 3   (paragraph, lists, to-do)
//   quote     17px × 1.60 = 27.2 → 13.6 − 11 = 3
//   code    16px panel padding + (13.5px × 1.70) / 2 − 11 = 16
//   table   the header row is ~40px tall → 20 − 11 = 9
//   divider the 1px rule is the whole content box → −11 + 1 = −10
const CONTROLS_TOP: Partial<Record<BlockType, string>> = {
  heading1: 'top-[8px]',
  heading2: 'top-[5px]',
  heading3: 'top-[2px]',
  code:     'top-[16px]',
  table:    'top-[9px]',
  divider:  'top-[-10px]',
};

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
  mirror.style.wordWrap = 'break-word';

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
function InlineToolbar({ onFormat }: { onFormat: (format: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-border bg-popover shadow-lg px-1.5 py-1">
      {[
        { label: <Bold className="size-3" />,          title: 'Bold',          format: 'bold' },
        { label: <Italic className="size-3" />,        title: 'Italic',        format: 'italic' },
        { label: <Underline className="size-3" />,     title: 'Underline',     format: 'underline' },
        { label: <Strikethrough className="size-3" />, title: 'Strikethrough', format: 'strikethrough' },
      ].map(({ label, title, format }) => (
        <button
          key={format}
          type="button"
          title={title}
          onMouseDown={(e) => { e.preventDefault(); onFormat(format); }}
          className="size-6 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150 flex items-center justify-center"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Textarea auto-resize ───────────────────────────────────────────────────────
function useAutoResize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
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
}

/**
 * One block: a 44px gutter holding its controls, then the content.
 *
 * No chrome until the pointer is on the row. The old row drew, on every block,
 * a hover background, a left accent bar, an add button, a grip and a "/cmd"
 * badge. What remains is one faint hover tint and the two gutter controls.
 * The "/" affordance the badge advertised is still in the empty paragraph's
 * placeholder and in the hint row above the editor.
 *
 * Below `md` the gutter is hidden rather than shrunk.
 */
function BlockRow({
  block, index, ordinal, total, focusedId,
  onFocus, onChange, onToggleCheck, onKeyDown,
  onAddAfter, onDelete, onChangeType, onMoveUp, onMoveDown,
  onUpdateTable, textareaRef, onSlashOpen,
}: BlockRowProps) {
  const [hovered, setHovered] = useState(false);
  const isFocused = focusedId === block.id;
  const showControls = hovered || isFocused;
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useAutoResize(taRef, block.content);

  const gutter = (
    <div className="relative hidden w-[var(--a-gutter)] flex-shrink-0 select-none md:block">
      <div
        className={cn(
          'absolute right-2 flex gap-[2px] transition-opacity duration-150',
          CONTROLS_TOP[block.type] ?? 'top-[3px]',
          // Also kept visible while a control has keyboard focus or its menu is open.
          showControls ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
        )}
      >
        <BlockControls
          block={block} index={index} total={total}
          onAddAfter={onAddAfter} onDelete={onDelete}
          onChangeType={onChangeType} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
        />
      </div>
    </div>
  );

  const rowProps = {
    className: cn(
      'relative flex rounded-[10px] transition-colors duration-150 first:mt-0',
      ROW_SPACING[block.type] ?? 'py-[3px]',
      hovered && 'bg-a-row-hover',
    ),
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  // ── Divider ──────────────────────────────────────────────────────────────────
  if (block.type === 'divider') {
    return (
      <div {...rowProps}>
        {gutter}
        <div className="flex flex-1 items-center">
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

      <div className={cn('flex min-w-0 flex-1 items-start', getContentWrapperClass(block.type))}>
        {block.type === 'bullet' && (
          <span
            aria-hidden
            className="mr-3 mt-[10px] size-1.5 flex-shrink-0 rounded-full bg-[color-mix(in_srgb,var(--a-ink)_45%,transparent)]"
          />
        )}

        {block.type === 'numbered' && (
          <span
            aria-hidden
            className="mr-2.5 w-[22px] flex-shrink-0 text-right text-[16.5px] leading-[1.68] tabular-nums text-a-muted"
          >
            {ordinal ?? 1}.
          </span>
        )}

        {block.type === 'todo' && (
          // The wrapper takes the 19px box's layout size; StatusBox's own padding
          // gives it a 44px hit area without pushing the text sideways.
          <span className="mr-3 mt-[4px] flex flex-shrink-0">
            <StatusBox
              state={block.checked ? 'done' : 'todo'}
              label={block.content.trim() || 'To-do'}
              onClick={() => onToggleCheck(block.id)}
            />
          </span>
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
          }}
          onKeyDown={(e) => onKeyDown(e, block.id)}
          onFocus={() => onFocus(block.id)}
          placeholder={getBlockPlaceholder(block.type)}
          rows={1}
          className={cn(
            'min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent p-0 outline-none',
            'placeholder:text-a-faint/55',
            getBlockTextClass(block.type),
            block.type === 'todo' && block.checked && 'text-a-faint line-through decoration-[1.5px]',
          )}
          style={{ height: 'auto' }}
          aria-label={`Block ${index + 1}: ${BLOCK_TYPE_LABELS[block.type] ?? 'Text'}`}
          spellCheck
        />
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
}

export function NoteEditor({
  blocks,
  onUpdateBlock,
  onAddBlock,
  onDeleteBlock,
  onChangeBlockType,
  onMoveBlock,
}: NoteEditorProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(null);
  const [slashState, setSlashState] = useState<{
    blockId: string;
    query: string;
    position: { top: number; left: number };
    selectedIndex: number;
  } | null>(null);

  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const pendingFocusId = useRef<string | null>(null);

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
  });

  // Selection toolbar
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setToolbarPos(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setToolbarPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

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
  }, [slashState, onUpdateBlock]);

  const handleToggleCheck = useCallback((blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (block) onUpdateBlock(blockId, { checked: !block.checked });
  }, [blocks, onUpdateBlock]);

  const handleUpdateTable = useCallback((blockId: string, tableData: TableData) => {
    onUpdateBlock(blockId, { tableData });
  }, [onUpdateBlock]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>, blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    const idx = blocks.findIndex((b) => b.id === blockId);
    const el = textareaRefs.current.get(blockId);
    const cursorAtStart = el?.selectionStart === 0 && el?.selectionEnd === 0;
    const cursorAtEnd = el && el.selectionStart === el.value.length;

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
  }, [blocks, slashState, onAddBlock, onDeleteBlock, onUpdateBlock, handleSlashSelect]);

  const handleAddAfter = useCallback((blockId: string) => {
    const newId = onAddBlock(blockId, 'paragraph');
    pendingFocusId.current = newId;
  }, [onAddBlock]);

  const handleFormat = useCallback((_format: string) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    setToolbarPos(null);
  }, []);

  return (
    <div className="relative">
      {/* Inline toolbar */}
      {toolbarPos && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full animate-fade-in"
          style={{ left: toolbarPos.x, top: toolbarPos.y }}
        >
          <InlineToolbar onFormat={handleFormat} />
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

      {/* Blocks */}
      <div>
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
            onDelete={onDeleteBlock}
            onChangeType={onChangeBlockType}
            onMoveUp={(id) => onMoveBlock(id, 'up')}
            onMoveDown={(id) => onMoveBlock(id, 'down')}
            onUpdateTable={handleUpdateTable}
            textareaRef={registerRef}
            onSlashOpen={handleSlashOpen}
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
        className="mt-2 w-full cursor-text py-6 text-left text-[13.5px] text-a-faint/60 transition-colors duration-200 hover:text-a-faint md:pl-[var(--a-gutter)]"
        aria-label="Add new block"
      >
        Click to add more…
      </button>
    </div>
  );
}

// ── Block type selector (exported for external use) ────────────────────────────
export function BlockTypeButton({
  currentType,
  onChangeType,
}: {
  currentType: BlockType;
  onChangeType: (type: BlockType) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="h-6 gap-1 text-muted-foreground hover:text-foreground rounded-lg px-2">
          {BLOCK_ICONS[currentType]}
          <span className="text-[10px]">{BLOCK_TYPE_LABELS[currentType]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {BLOCK_TYPES.map((type) => (
          <DropdownMenuItem
            key={type}
            onClick={() => onChangeType(type)}
            className={cn(type === currentType && 'bg-muted')}
          >
            {BLOCK_ICONS[type]}
            <span className="text-xs">{BLOCK_TYPE_LABELS[type]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Re-export createEmptyBlock for convenience
export { createEmptyBlock };
