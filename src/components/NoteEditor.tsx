import {
  useRef, useEffect, useCallback, useState,
  KeyboardEvent,
} from 'react';
import {
  Plus, GripVertical, Trash2, ArrowUp, ArrowDown,
  Type, Heading1, Heading2, Heading3, List, ListOrdered,
  CheckSquare, Quote, Minus, Code2, Table2,
  Bold, Italic, Underline, Strikethrough, Slash,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteBlock, BlockType, TableData } from '@/types/notes';
import { BLOCK_TYPE_LABELS, createEmptyBlock } from '@/types/notes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SlashMenu, filterSlashCommands } from '@/components/notes/SlashMenu';
import { TableBlock } from '@/components/notes/TableBlock';

// ── Block type icon map ────────────────────────────────────────────────────────
const BLOCK_ICONS: Record<BlockType, React.ReactNode> = {
  paragraph: <Type className="size-3.5" />,
  heading1:  <Heading1 className="size-3.5" />,
  heading2:  <Heading2 className="size-3.5" />,
  heading3:  <Heading3 className="size-3.5" />,
  bullet:    <List className="size-3.5" />,
  numbered:  <ListOrdered className="size-3.5" />,
  todo:      <CheckSquare className="size-3.5" />,
  quote:     <Quote className="size-3.5" />,
  divider:   <Minus className="size-3.5" />,
  code:      <Code2 className="size-3.5" />,
  table:     <Table2 className="size-3.5" />,
};

const BLOCK_TYPES: BlockType[] = [
  'paragraph', 'heading1', 'heading2', 'heading3',
  'bullet', 'numbered', 'todo', 'quote', 'divider', 'code', 'table',
];

// ── Block content styling ──────────────────────────────────────────────────────
function getBlockTextClass(type: BlockType): string {
  switch (type) {
    case 'heading1': return 'text-2xl font-bold tracking-tight text-foreground leading-tight';
    case 'heading2': return 'text-xl font-semibold tracking-tight text-foreground leading-snug';
    case 'heading3': return 'text-base font-semibold text-foreground leading-snug';
    case 'quote':    return 'text-sm italic text-muted-foreground leading-relaxed';
    case 'code':     return 'text-sm font-mono text-foreground leading-relaxed';
    case 'bullet':   return 'text-sm text-foreground leading-relaxed';
    case 'numbered': return 'text-sm text-foreground leading-relaxed';
    case 'todo':     return 'text-sm text-foreground leading-relaxed';
    default:         return 'text-sm text-foreground leading-relaxed';
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

// Per-type top offset so the 24px grip button's center aligns with the
// vertical midpoint of the first text line's cap-height.
//
// Formula: mt = (line-height / 2) - (button-height / 2)
//   heading1  text-2xl  leading-tight  → lh ≈ 30px  → mt = 15 - 12 = 3px
//   heading2  text-xl   leading-snug   → lh ≈ 28px  → mt = 14 - 12 = 2px
//   heading3  text-base leading-snug   → lh ≈ 24px  → mt = 12 - 12 = 0px
//   code/quote text-sm  leading-relaxed→ lh ≈ 23px  → mt = 11 - 12 = -1px → 0
//   paragraph  text-sm  leading-relaxed→ lh ≈ 23px  → mt ≈ 0px
function getControlsTopOffset(type: BlockType): string {
  switch (type) {
    case 'heading1': return 'mt-[3px]';
    case 'heading2': return 'mt-[2px]';
    case 'heading3': return 'mt-0';
    case 'code':     return 'mt-[6px]';   // code block has py-2 wrapper padding
    case 'quote':    return 'mt-0';
    default:         return 'mt-0';
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

// ── Block controls (grip + plus + type menu) ───────────────────────────────────
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

function BlockControls({ block, index, total, onAddAfter, onDelete, onChangeType, onMoveUp, onMoveDown }: BlockControlsProps) {
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      {/* Add block */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onAddAfter(block.id)}
        className="size-5 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded transition-all duration-150"
        aria-label="Add block below"
        title="Add block below (or type / for commands)"
      >
        <Plus className="size-3" />
      </Button>

      {/* Grip + type/move/delete menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground/40 hover:text-foreground hover:bg-muted/80 rounded cursor-grab active:cursor-grabbing transition-all duration-150"
            aria-label="Block options"
            title="Click for options · drag to reorder"
          >
            <GripVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
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

          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Turn into
          </div>
          {BLOCK_TYPES.filter((t) => t !== block.type).map((type) => (
            <DropdownMenuItem key={type} onClick={() => onChangeType(block.id, type)}>
              {BLOCK_ICONS[type]}
              <span className="text-xs">{BLOCK_TYPE_LABELS[type]}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(block.id)}>
            <Trash2 className="size-3.5" /> Delete block
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Slash command hint badge ────────────────────────────────────────────────────
function SlashHint({ visible }: { visible: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 h-4 px-1.5 rounded text-[9px] font-mono font-semibold select-none flex-shrink-0',
        'bg-primary/8 text-primary/50 border border-primary/15',
        'transition-all duration-200',
        visible ? 'opacity-100 translate-x-0' : 'opacity-30 translate-x-0',
      )}
      title="Type / to insert a block"
    >
      <Slash className="size-2.5" />
      <span className="text-[8px] tracking-tight">cmd</span>
    </span>
  );
}

// ── Single Block Row ───────────────────────────────────────────────────────────
interface BlockRowProps {
  block: NoteBlock;
  index: number;
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

function BlockRow({
  block, index, total, focusedId,
  onFocus, onChange, onToggleCheck, onKeyDown,
  onAddAfter, onDelete, onChangeType, onMoveUp, onMoveDown,
  onUpdateTable, textareaRef, onSlashOpen,
}: BlockRowProps) {
  const [hovered, setHovered] = useState(false);
  const isFocused = focusedId === block.id;
  const showControls = hovered || isFocused;
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useAutoResize(taRef, block.content);

  // Shared left-side controls strip: grip + plus + slash hint
  const sharedControls = (
    <div className={cn(
      'flex items-center gap-0.5 flex-shrink-0 transition-all duration-150 select-none',
      showControls ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1',
    )}>
      <BlockControls
        block={block} index={index} total={total}
        onAddAfter={onAddAfter} onDelete={onDelete}
        onChangeType={onChangeType} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
      />
    </div>
  );

  // ── Divider ──────────────────────────────────────────────────────────────────
  if (block.type === 'divider') {
    return (
      <div
        className={cn(
          'relative flex items-center gap-2 py-2 px-1 rounded-lg transition-all duration-150',
          hovered ? 'bg-muted/20' : 'bg-transparent',
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {sharedControls}
        <hr className="flex-1 border-border/60" />
      </div>
    );
  }

  // ── Table ────────────────────────────────────────────────────────────────────
  if (block.type === 'table') {
    return (
      <div
        className={cn(
          'relative flex items-start gap-1.5 py-1 px-1 rounded-xl transition-all duration-150',
          hovered ? 'bg-muted/20' : 'bg-transparent',
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Controls aligned to table toolbar height (~30px) → mt-[7px] */}
        <div className={cn(
          'flex items-center gap-0.5 mt-[7px] flex-shrink-0 transition-all duration-150 select-none',
          showControls ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1',
        )}>
          <BlockControls
            block={block} index={index} total={total}
            onAddAfter={onAddAfter} onDelete={onDelete}
            onChangeType={onChangeType} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
          />
        </div>
        <div className="flex-1 min-w-0">
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
    <div
      className={cn(
        'relative flex items-start gap-1.5 px-1 rounded-lg transition-all duration-150 group/blockrow',
        hovered ? 'bg-muted/20' : 'bg-transparent',
        isFocused && !hovered && 'bg-muted/10',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Subtle left accent bar on hover/focus */}
      <div className={cn(
        'absolute left-0 top-1 bottom-1 w-0.5 rounded-full transition-all duration-200',
        isFocused ? 'bg-primary/50 opacity-100' : hovered ? 'bg-primary/25 opacity-100' : 'opacity-0',
      )} />

      {/* Controls — self-start + per-type top margin to align grip with text cap-height */}
      <div className={cn(
        'flex items-center gap-1 self-start flex-shrink-0 transition-all duration-150 select-none',
        getControlsTopOffset(block.type),
        showControls ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1',
      )}>
        <BlockControls
          block={block} index={index} total={total}
          onAddAfter={onAddAfter} onDelete={onDelete}
          onChangeType={onChangeType} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
        />
      </div>

      {/* Slash hint — always visible for empty paragraph blocks, outside controls opacity */}
      {block.type === 'paragraph' && block.content === '' && (
        <div className={cn(
          'self-start flex-shrink-0 transition-all duration-200 select-none',
          getControlsTopOffset(block.type),
          showControls ? 'opacity-100' : 'opacity-40',
        )}>
          <SlashHint visible={showControls} />
        </div>
      )}

      {/* Block content area */}
      <div className={cn(
        'flex items-start gap-2 flex-1 min-w-0',
        block.type === 'quote' && 'border-l-2 border-primary/40 pl-3',
        block.type === 'code' && 'bg-muted/50 rounded-lg px-3 py-2',
      )}>
        {/* Bullet marker */}
        {block.type === 'bullet' && (
          <span className="mt-[8px] size-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
        )}
        {/* Numbered marker */}
        {block.type === 'numbered' && (
          <span className="mt-[3px] text-xs font-medium tabular-nums text-muted-foreground flex-shrink-0 w-5 text-right leading-relaxed">
            {index + 1}.
          </span>
        )}
        {/* Todo checkbox */}
        {block.type === 'todo' && (
          <button
            type="button"
            onClick={() => onToggleCheck(block.id)}
            className={cn(
              'mt-[3px] size-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all duration-150',
              block.checked
                ? 'bg-primary border-primary'
                : 'border-muted-foreground/40 hover:border-primary/60'
            )}
            aria-label={block.checked ? 'Uncheck' : 'Check'}
          >
            {block.checked && (
              <svg viewBox="0 0 10 8" className="size-2.5 text-primary-foreground fill-current">
                <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        {/* Textarea */}
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
            'flex-1 min-w-0 resize-none bg-transparent outline-none border-none p-0 leading-relaxed overflow-hidden',
            'placeholder:text-muted-foreground/35 focus:placeholder:text-muted-foreground/50 transition-colors duration-150',
            getBlockTextClass(block.type),
            block.type === 'todo' && block.checked && 'line-through text-muted-foreground/60',
          )}
          style={{ height: 'auto' }}
          aria-label={`Block ${index + 1}: ${BLOCK_TYPE_LABELS[block.type]}`}
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
      <div className="space-y-0.5">
        {blocks.map((block, index) => (
          <BlockRow
            key={block.id}
            block={block}
            index={index}
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
        className="w-full mt-2 py-6 text-left text-xs text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors duration-200 cursor-text"
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
