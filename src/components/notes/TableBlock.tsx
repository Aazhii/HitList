import { useRef, useCallback, useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Plus, Trash2, AlignLeft, AlignCenter, AlignRight,
  ChevronDown, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  MoreHorizontal, GripVertical, LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteBlock, TableData, ColumnAlign } from '@/types/notes';
import { createEmptyTable } from '@/types/notes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

const DEFAULT_COL_WIDTH = 140;
const MIN_COL_WIDTH = 60;

interface TableBlockProps {
  block: NoteBlock;
  isFocused: boolean;
  onUpdateTable: (tableData: TableData) => void;
  onFocus: (id: string) => void;
}

export function TableBlock({ block, isFocused, onUpdateTable, onFocus }: TableBlockProps) {
  const tableData = block.tableData ?? createEmptyTable();
  const { rows, hasHeader } = tableData;
  const numCols = rows[0]?.length ?? 3;
  const numRows = rows.length;

  // Normalize widths/aligns arrays to match current col count
  const colWidths: number[] = Array.from({ length: numCols }, (_, i) =>
    tableData.colWidths?.[i] ?? DEFAULT_COL_WIDTH
  );
  const colAligns: ColumnAlign[] = Array.from({ length: numCols }, (_, i) =>
    tableData.colAligns?.[i] ?? 'left'
  );

  const cellRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [tableHovered, setTableHovered] = useState(false);

  // Column resize state
  const resizeState = useRef<{
    colIdx: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const getCellKey = (r: number, c: number) => `${r}-${c}`;

  const autoResizeCell = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const updateCell = useCallback((rowIdx: number, colIdx: number, value: string) => {
    const newRows = rows.map((row, ri) =>
      ri === rowIdx ? row.map((cell, ci) => (ci === colIdx ? value : cell)) : row
    );
    onUpdateTable({ ...tableData, rows: newRows, colWidths, colAligns });
  }, [rows, tableData, colWidths, colAligns, onUpdateTable]);

  // ── Row operations ──────────────────────────────────────────────────────────
  const addRowAfter = useCallback((rowIdx: number) => {
    const newRows = [
      ...rows.slice(0, rowIdx + 1),
      Array(numCols).fill(''),
      ...rows.slice(rowIdx + 1),
    ];
    onUpdateTable({ ...tableData, rows: newRows, colWidths, colAligns });
  }, [rows, numCols, tableData, colWidths, colAligns, onUpdateTable]);

  const addRowBefore = useCallback((rowIdx: number) => {
    const newRows = [
      ...rows.slice(0, rowIdx),
      Array(numCols).fill(''),
      ...rows.slice(rowIdx),
    ];
    onUpdateTable({ ...tableData, rows: newRows, colWidths, colAligns });
  }, [rows, numCols, tableData, colWidths, colAligns, onUpdateTable]);

  const deleteRow = useCallback((rowIdx: number) => {
    if (numRows <= 1) return;
    const newRows = rows.filter((_, i) => i !== rowIdx);
    onUpdateTable({ ...tableData, rows: newRows, colWidths, colAligns });
  }, [rows, numRows, tableData, colWidths, colAligns, onUpdateTable]);

  const moveRowUp = useCallback((rowIdx: number) => {
    if (rowIdx === 0) return;
    const newRows = [...rows];
    [newRows[rowIdx - 1], newRows[rowIdx]] = [newRows[rowIdx], newRows[rowIdx - 1]];
    onUpdateTable({ ...tableData, rows: newRows, colWidths, colAligns });
  }, [rows, tableData, colWidths, colAligns, onUpdateTable]);

  const moveRowDown = useCallback((rowIdx: number) => {
    if (rowIdx >= numRows - 1) return;
    const newRows = [...rows];
    [newRows[rowIdx], newRows[rowIdx + 1]] = [newRows[rowIdx + 1], newRows[rowIdx]];
    onUpdateTable({ ...tableData, rows: newRows, colWidths, colAligns });
  }, [rows, numRows, tableData, colWidths, colAligns, onUpdateTable]);

  // ── Column operations ───────────────────────────────────────────────────────
  const addColAfter = useCallback((colIdx: number) => {
    const newRows = rows.map((row) => [
      ...row.slice(0, colIdx + 1),
      '',
      ...row.slice(colIdx + 1),
    ]);
    const newWidths = [...colWidths.slice(0, colIdx + 1), DEFAULT_COL_WIDTH, ...colWidths.slice(colIdx + 1)];
    const newAligns = [...colAligns.slice(0, colIdx + 1), 'left' as ColumnAlign, ...colAligns.slice(colIdx + 1)];
    onUpdateTable({ ...tableData, rows: newRows, colWidths: newWidths, colAligns: newAligns });
  }, [rows, colWidths, colAligns, tableData, onUpdateTable]);

  const addColBefore = useCallback((colIdx: number) => {
    const newRows = rows.map((row) => [
      ...row.slice(0, colIdx),
      '',
      ...row.slice(colIdx),
    ]);
    const newWidths = [...colWidths.slice(0, colIdx), DEFAULT_COL_WIDTH, ...colWidths.slice(colIdx)];
    const newAligns = [...colAligns.slice(0, colIdx), 'left' as ColumnAlign, ...colAligns.slice(colIdx)];
    onUpdateTable({ ...tableData, rows: newRows, colWidths: newWidths, colAligns: newAligns });
  }, [rows, colWidths, colAligns, tableData, onUpdateTable]);

  const deleteColumn = useCallback((colIdx: number) => {
    if (numCols <= 1) return;
    const newRows = rows.map((row) => row.filter((_, i) => i !== colIdx));
    const newWidths = colWidths.filter((_, i) => i !== colIdx);
    const newAligns = colAligns.filter((_, i) => i !== colIdx);
    onUpdateTable({ ...tableData, rows: newRows, colWidths: newWidths, colAligns: newAligns });
  }, [rows, numCols, colWidths, colAligns, tableData, onUpdateTable]);

  const setColAlign = useCallback((colIdx: number, align: ColumnAlign) => {
    const newAligns = colAligns.map((a, i) => (i === colIdx ? align : a));
    onUpdateTable({ ...tableData, rows, colWidths, colAligns: newAligns });
  }, [rows, colWidths, colAligns, tableData, onUpdateTable]);

  const moveColLeft = useCallback((colIdx: number) => {
    if (colIdx === 0) return;
    const newRows = rows.map((row) => {
      const r = [...row];
      [r[colIdx - 1], r[colIdx]] = [r[colIdx], r[colIdx - 1]];
      return r;
    });
    const newWidths = [...colWidths];
    [newWidths[colIdx - 1], newWidths[colIdx]] = [newWidths[colIdx], newWidths[colIdx - 1]];
    const newAligns = [...colAligns];
    [newAligns[colIdx - 1], newAligns[colIdx]] = [newAligns[colIdx], newAligns[colIdx - 1]];
    onUpdateTable({ ...tableData, rows: newRows, colWidths: newWidths, colAligns: newAligns });
  }, [rows, colWidths, colAligns, tableData, onUpdateTable]);

  const moveColRight = useCallback((colIdx: number) => {
    if (colIdx >= numCols - 1) return;
    const newRows = rows.map((row) => {
      const r = [...row];
      [r[colIdx], r[colIdx + 1]] = [r[colIdx + 1], r[colIdx]];
      return r;
    });
    const newWidths = [...colWidths];
    [newWidths[colIdx], newWidths[colIdx + 1]] = [newWidths[colIdx + 1], newWidths[colIdx]];
    const newAligns = [...colAligns];
    [newAligns[colIdx], newAligns[colIdx + 1]] = [newAligns[colIdx + 1], newAligns[colIdx]];
    onUpdateTable({ ...tableData, rows: newRows, colWidths: newWidths, colAligns: newAligns });
  }, [rows, numCols, colWidths, colAligns, tableData, onUpdateTable]);

  // ── Column resize ───────────────────────────────────────────────────────────
  const startResize = useCallback((e: React.MouseEvent, colIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = {
      colIdx,
      startX: e.clientX,
      startWidth: colWidths[colIdx],
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeState.current) return;
      const delta = ev.clientX - resizeState.current.startX;
      const newWidth = Math.max(MIN_COL_WIDTH, resizeState.current.startWidth + delta);
      const newWidths = colWidths.map((w, i) =>
        i === resizeState.current!.colIdx ? newWidth : w
      );
      onUpdateTable({ ...tableData, rows, colWidths: newWidths, colAligns });
    };

    const onMouseUp = () => {
      resizeState.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [colWidths, colAligns, rows, tableData, onUpdateTable]);

  // ── Cell keyboard navigation ────────────────────────────────────────────────
  const handleCellKeyDown = useCallback((
    e: KeyboardEvent<HTMLTextAreaElement>,
    rowIdx: number,
    colIdx: number
  ) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.shiftKey) {
        if (colIdx < numCols - 1) {
          cellRefs.current.get(getCellKey(rowIdx, colIdx + 1))?.focus();
        } else if (rowIdx < numRows - 1) {
          cellRefs.current.get(getCellKey(rowIdx + 1, 0))?.focus();
        } else {
          addRowAfter(numRows - 1);
          setTimeout(() => cellRefs.current.get(getCellKey(numRows, 0))?.focus(), 0);
        }
      } else {
        if (colIdx > 0) {
          cellRefs.current.get(getCellKey(rowIdx, colIdx - 1))?.focus();
        } else if (rowIdx > 0) {
          cellRefs.current.get(getCellKey(rowIdx - 1, numCols - 1))?.focus();
        }
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (rowIdx < numRows - 1) {
        cellRefs.current.get(getCellKey(rowIdx + 1, colIdx))?.focus();
      } else {
        addRowAfter(numRows - 1);
        setTimeout(() => cellRefs.current.get(getCellKey(numRows, colIdx))?.focus(), 0);
      }
    } else if (e.key === 'Escape') {
      (e.target as HTMLTextAreaElement).blur();
      setSelectedCell(null);
    }
  }, [numCols, numRows, addRowAfter]);

  // ── Add row/col buttons ─────────────────────────────────────────────────────
  const addRow = useCallback(() => addRowAfter(numRows - 1), [addRowAfter, numRows]);
  const addCol = useCallback(() => addColAfter(numCols - 1), [addColAfter, numCols]);

  // Cleanup resize on unmount
  useEffect(() => {
    return () => { resizeState.current = null; };
  }, []);

  const alignIcon = (align: ColumnAlign) => {
    if (align === 'center') return <AlignCenter className="size-3" />;
    if (align === 'right') return <AlignRight className="size-3" />;
    return <AlignLeft className="size-3" />;
  };

  // Derive column label: use header cell content if hasHeader, else "Col N"
  const getColLabel = (colIdx: number): string => {
    if (hasHeader && rows[0]?.[colIdx]?.trim()) {
      return rows[0][colIdx].trim();
    }
    return `Col ${colIdx + 1}`;
  };

  // Check if table is completely empty (all cells blank)
  const isEmpty = rows.every((row) => row.every((cell) => cell.trim() === ''));

  const tableWidth = colWidths.reduce((a, b) => a + b, 0) + 32;

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-all duration-200 bg-card relative',
        isFocused
          ? 'border-primary/50 shadow-lg shadow-primary/5'
          : tableHovered
            ? 'border-border/80 shadow-sm'
            : 'border-border/60'
      )}
      onClick={() => onFocus(block.id)}
      onMouseEnter={() => setTableHovered(true)}
      onMouseLeave={() => setTableHovered(false)}
    >
        {/* ── Table toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/30 border-b border-border/50">
        <LayoutGrid className="size-3 text-muted-foreground/50 flex-shrink-0" />
        <span className="text-[10px] font-semibold text-muted-foreground mr-auto">
          {numRows} rows · {numCols} cols
        </span>

        {/* Keyboard shortcuts */}
        <span className="hidden sm:flex items-center gap-1.5 text-[9px] text-muted-foreground/50 mr-1.5">
          <span className="flex items-center gap-0.5">
            <kbd className="font-mono bg-muted/80 border border-border/70 px-1 py-px rounded text-[8px] leading-none shadow-[0_1px_0_0_hsl(var(--border)/0.5)]">Tab</kbd>
            <span className="text-muted-foreground/40">next</span>
          </span>
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-0.5">
            <kbd className="font-mono bg-muted/80 border border-border/70 px-1 py-px rounded text-[8px] leading-none shadow-[0_1px_0_0_hsl(var(--border)/0.5)]">⇧Tab</kbd>
            <span className="text-muted-foreground/40">prev</span>
          </span>
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-0.5">
            <kbd className="font-mono bg-muted/80 border border-border/70 px-1 py-px rounded text-[8px] leading-none shadow-[0_1px_0_0_hsl(var(--border)/0.5)]">↵</kbd>
            <span className="text-muted-foreground/40">new row</span>
          </span>
          <span className="text-border/60">·</span>
          <span className="flex items-center gap-0.5">
            <kbd className="font-mono bg-muted/80 border border-border/70 px-1 py-px rounded text-[8px] leading-none shadow-[0_1px_0_0_hsl(var(--border)/0.5)]">Esc</kbd>
            <span className="text-muted-foreground/40">exit</span>
          </span>
        </span>

        {/* Header toggle */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onUpdateTable({ ...tableData, rows, colWidths, colAligns, hasHeader: !hasHeader })}
          className={cn(
            'h-5 px-2 rounded text-[9px] font-semibold transition-all duration-150 flex items-center gap-1',
            hasHeader
              ? 'text-primary bg-primary/10 hover:bg-primary/20 ring-1 ring-primary/20'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
          )}
          title={hasHeader ? 'Remove header row' : 'Add header row'}
        >
          Header
        </button>

        {/* Add column */}
        <Button
          variant="ghost"
          size="icon-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addCol}
          className="size-6 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors duration-150"
          title="Add column (right)  →"
        >
          <ArrowRight className="size-3" />
        </Button>

        {/* Add row */}
        <Button
          variant="ghost"
          size="icon-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addRow}
          className="size-6 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors duration-150"
          title="Add row (bottom)  ↓"
        >
          <ArrowDown className="size-3" />
        </Button>
      </div>

      {/* ── Table grid ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table
          className="border-collapse"
          style={{ tableLayout: 'fixed', width: tableWidth }}
        >
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            {/* gutter col for row menus */}
            <col style={{ width: 32 }} />
          </colgroup>

          <tbody>
            {/* ── Column header row (always shown above data) ── */}
            <tr className="group/colheader">
              {Array.from({ length: numCols }).map((_, colIdx) => (
                <th
                  key={colIdx}
                  className={cn(
                    'relative border-b border-r border-border/60 last:border-r-0 p-0 transition-colors duration-100',
                    hoveredCol === colIdx
                      ? 'bg-primary/8'
                      : 'bg-muted/20'
                  )}
                  onMouseEnter={() => setHoveredCol(colIdx)}
                  onMouseLeave={() => setHoveredCol(null)}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        className={cn(
                          'w-full flex items-center justify-between gap-1 px-2 py-1.5 text-left',
                          'text-[10px] font-semibold text-muted-foreground uppercase tracking-wide',
                          'hover:bg-muted/60 transition-colors duration-100 group/colbtn'
                        )}
                      >
                        <span className="flex items-center gap-1 min-w-0">
                          <span className="opacity-40 group-hover/colbtn:opacity-70 transition-opacity">
                            {alignIcon(colAligns[colIdx])}
                          </span>
                          <span className="truncate">{getColLabel(colIdx)}</span>
                        </span>
                        <ChevronDown className="size-2.5 opacity-0 group-hover/colbtn:opacity-60 transition-opacity flex-shrink-0" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Column {colIdx + 1}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => addColBefore(colIdx)}>
                        <ArrowLeft className="size-3.5" /> Insert left
                      </DropdownMenuItem>
                      <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => addColAfter(colIdx)}>
                        <ArrowRight className="size-3.5" /> Insert right
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Align
                      </div>
                      {(['left', 'center', 'right'] as ColumnAlign[]).map((a) => (
                        <DropdownMenuItem
                          key={a}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setColAlign(colIdx, a)}
                          className={cn(colAligns[colIdx] === a && 'bg-muted')}
                        >
                          {a === 'left' && <AlignLeft className="size-3.5" />}
                          {a === 'center' && <AlignCenter className="size-3.5" />}
                          {a === 'right' && <AlignRight className="size-3.5" />}
                          <span className="capitalize">{a}</span>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => moveColLeft(colIdx)} disabled={colIdx === 0}>
                        <ArrowLeft className="size-3.5" /> Move left
                      </DropdownMenuItem>
                      <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => moveColRight(colIdx)} disabled={colIdx >= numCols - 1}>
                        <ArrowRight className="size-3.5" /> Move right
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => deleteColumn(colIdx)}
                        disabled={numCols <= 1}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="size-3.5" /> Delete column
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Column hover top-edge indicator bar */}
                  <div className={cn(
                    'absolute top-0 left-0 right-0 h-0.5 rounded-b-full transition-all duration-150 pointer-events-none z-20',
                    hoveredCol === colIdx ? 'bg-primary/60 opacity-100' : 'opacity-0',
                  )} />

                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary/70 transition-colors duration-100 z-10 group/resize"
                    onMouseDown={(e) => startResize(e, colIdx)}
                  >
                    <div className="absolute inset-y-2 right-0 w-px bg-border/60 group-hover/resize:bg-primary/60 transition-colors duration-100" />
                  </div>
                </th>
              ))}
              {/* gutter header */}
              <th className="border-b border-border/60 bg-muted/20 w-8" />
            </tr>

            {/* ── Data rows ── */}
            {rows.map((row, rowIdx) => {
              const isHeader = hasHeader && rowIdx === 0;
              const isRowHovered = hoveredRow === rowIdx;
              const isRowSelected = selectedCell?.row === rowIdx;
              return (
                <tr
                  key={rowIdx}
                  className="group/row"
                  onMouseEnter={() => setHoveredRow(rowIdx)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                   {row.map((cell, colIdx) => {
                     const cellKey = getCellKey(rowIdx, colIdx);
                     const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx;
                     const isColHovered = hoveredCol === colIdx;
                     return (
                       <td
                         key={colIdx}
                         className={cn(
                           'relative border-b border-r border-border/40 last:border-r-0 p-0 transition-colors duration-100',
                           isHeader && 'bg-muted/30',
                           rowIdx === numRows - 1 && 'border-b-0',
                           // Column highlight (lower priority than row/selected)
                           !isHeader && isColHovered && !isRowHovered && !isSelected && 'bg-primary/[0.06]',
                           // Row highlight
                           !isHeader && isRowHovered && !isSelected && 'bg-muted/25',
                           // Both row + col hovered
                           !isHeader && isRowHovered && isColHovered && !isSelected && 'bg-primary/[0.08]',
                           // Selected cell
                           isSelected && 'bg-primary/10',
                         )}
                         onMouseEnter={() => setHoveredCol(colIdx)}
                         onMouseLeave={() => setHoveredCol(null)}
                       >
                         {/* Selected cell border ring */}
                         {isSelected && (
                           <div className="absolute inset-0 ring-2 ring-inset ring-primary/60 pointer-events-none z-10 rounded-[1px]" />
                         )}
                         {/* Column hover top indicator */}
                         {isColHovered && rowIdx === 0 && (
                           <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary/40 pointer-events-none z-10" />
                         )}
                         <textarea
                           ref={(el) => {
                             if (el) {
                               cellRefs.current.set(cellKey, el);
                               autoResizeCell(el);
                             } else {
                               cellRefs.current.delete(cellKey);
                             }
                           }}
                           value={cell}
                           onChange={(e) => {
                             updateCell(rowIdx, colIdx, e.target.value);
                             autoResizeCell(e.target);
                           }}
                           onKeyDown={(e) => handleCellKeyDown(e, rowIdx, colIdx)}
                           onFocus={() => setSelectedCell({ row: rowIdx, col: colIdx })}
                           onBlur={() => setSelectedCell(null)}
                           rows={1}
                           className={cn(
                             'w-full resize-none bg-transparent outline-none border-none px-2.5 py-2 leading-relaxed overflow-hidden',
                             'placeholder:text-muted-foreground/30 transition-colors duration-150',
                             isHeader
                               ? 'text-xs font-semibold text-foreground'
                               : 'text-xs text-foreground',
                             colAligns[colIdx] === 'center' && 'text-center',
                             colAligns[colIdx] === 'right' && 'text-right',
                           )}
                           placeholder={isHeader ? (colIdx === 0 ? 'Column name…' : `Column ${colIdx + 1}`) : (isRowHovered ? '…' : '')}
                           style={{ height: 'auto', minHeight: '34px' }}
                         />
                       </td>
                     );
                   })}

                   {/* Row menu gutter */}
                   <td className={cn(
                     'w-8 p-0 border-b border-border/40 align-middle transition-colors duration-100',
                     rowIdx === numRows - 1 && 'border-b-0',
                     !isHeader && isRowHovered && !isRowSelected && 'bg-muted/20',
                   )}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          className={cn(
                            'size-6 mx-1 flex items-center justify-center rounded-md',
                            'text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/60',
                            'opacity-0 group-hover/row:opacity-100 transition-all duration-150'
                          )}
                          title="Row options"
                        >
                          <MoreHorizontal className="size-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Row {rowIdx + 1}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => addRowBefore(rowIdx)}>
                          <ArrowUp className="size-3.5" /> Insert above
                        </DropdownMenuItem>
                        <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => addRowAfter(rowIdx)}>
                          <ArrowDown className="size-3.5" /> Insert below
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => moveRowUp(rowIdx)} disabled={rowIdx === 0}>
                          <ArrowUp className="size-3.5" /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => moveRowDown(rowIdx)} disabled={rowIdx >= numRows - 1}>
                          <ArrowDown className="size-3.5" /> Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => deleteRow(rowIdx)}
                          disabled={numRows <= 1}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="size-3.5" /> Delete row
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Add row button — always visible dashed strip below table ───────── */}
      <div
        className={cn(
          'flex items-center border-t border-dashed transition-all duration-200',
          tableHovered || isFocused
            ? 'border-primary/30 opacity-100'
            : 'border-border/30 opacity-60'
        )}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addRow}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-1.5 group/addrow',
            'text-[11px] font-medium text-muted-foreground/40',
            'hover:text-primary hover:bg-primary/5',
            'transition-all duration-150'
          )}
          title="Add row  ↓"
        >
          <span className={cn(
            'size-4 rounded-full flex items-center justify-center border border-dashed',
            'border-muted-foreground/25 group-hover/addrow:border-primary/60 group-hover/addrow:bg-primary/10 group-hover/addrow:text-primary',
            'transition-all duration-150'
          )}>
            <Plus className="size-2.5" />
          </span>
          <span className="group-hover/addrow:opacity-100 opacity-0 transition-opacity duration-150 text-primary text-[11px] font-medium">
            Add row
          </span>
        </button>
      </div>

      {/* ── Empty state overlay ─────────────────────────────────────────── */}
      {isEmpty && !isFocused && !tableHovered && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center gap-2 px-4 py-3 rounded-xl bg-muted/20 border border-dashed border-border/40 backdrop-blur-[1px]">
            <div className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/50 select-none font-medium tracking-tight">
                Empty table — click to start editing
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/30 select-none">
              <kbd className="font-mono bg-muted/60 border border-border/50 px-1 py-px rounded text-[8px] leading-none">Tab</kbd>
              <span>navigate</span>
              <span className="text-border/50">·</span>
              <kbd className="font-mono bg-muted/60 border border-border/50 px-1 py-px rounded text-[8px] leading-none">↵</kbd>
              <span>new row</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Add column button — prominent dashed strip right of table ─────── */}
      <div
        className={cn(
          'absolute top-0 bottom-0 flex items-center transition-all duration-200',
          tableHovered || isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        style={{ left: tableWidth + 1 }}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addCol}
          className={cn(
            'flex flex-col items-center justify-center w-7 h-full group/addcol',
            'text-muted-foreground/40 hover:text-primary',
            'border-l border-dashed border-primary/30 hover:bg-primary/5',
            'transition-all duration-150 rounded-r-xl'
          )}
          title="Add column  →"
        >
          <span className={cn(
            'size-4 rounded-full flex items-center justify-center border border-dashed',
            'border-muted-foreground/30 group-hover/addcol:border-primary/60 group-hover/addcol:bg-primary/10 group-hover/addcol:text-primary',
            'transition-all duration-150'
          )}>
            <Plus className="size-2.5 group-hover/addcol:scale-110 transition-transform duration-150" />
          </span>
        </button>
      </div>

      {/* ── Footer: resize hint ───────────────────────────────────────────── */}
      <div className={cn(
        'flex items-center justify-end px-3 py-1 border-t border-border/30 bg-muted/5',
        'transition-all duration-200',
        tableHovered || isFocused ? 'opacity-100' : 'opacity-40'
      )}>
        <span className="text-[9px] text-muted-foreground/40 flex items-center gap-1.5">
          <GripVertical className="size-2.5" />
          <span>Drag column edge to resize</span>
        </span>
      </div>
    </div>
  );
}
