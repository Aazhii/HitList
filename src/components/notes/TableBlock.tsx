import { useRef, useCallback, useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Plus, Trash2, AlignLeft, AlignCenter, AlignRight,
  ChevronDown, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NoteBlock, TableData, ColumnAlign } from '@/types/notes';
import { createEmptyTable } from '@/types/notes';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const DEFAULT_COL_WIDTH = 140;
const MIN_COL_WIDTH = 60;
/** Width of the column that holds each row's menu. */
const GUTTER_WIDTH = 32;

interface TableBlockProps {
  block: NoteBlock;
  isFocused: boolean;
  onUpdateTable: (tableData: TableData) => void;
  onFocus: (id: string) => void;
}

/**
 * A table block.
 *
 * The redesign removes six pieces of chrome that used to surround the grid: a
 * toolbar with a row/column count, two keyboard legends, a dashed add-row strip,
 * a dashed add-column rail (which was clipped by overflow-hidden on any wide
 * table), a resize-hint footer, and an empty-state overlay.
 *
 * Every capability they carried is still reachable:
 *   add row / add column   → the "+" on the bottom and right edges, on hover or focus
 *   row operations         → each row's menu in the right-hand gutter
 *   column operations      → the menu on each first-row cell, which also holds
 *                            the header-row toggle and alignment
 *   resize                 → the handle on each cell's right edge
 *   keyboard               → unchanged; see handleCellKeyDown
 */
export function TableBlock({ block, isFocused, onUpdateTable, onFocus }: TableBlockProps) {
  const tableData = block.tableData ?? createEmptyTable();
  const { rows, hasHeader } = tableData;
  const numCols = rows[0]?.length ?? 3;
  const numRows = rows.length;

  // Normalised to the current column count on every render. This is what makes
  // adding and deleting columns safe when widths or aligns are missing or stale.
  const colWidths: number[] = Array.from({ length: numCols }, (_, i) =>
    tableData.colWidths?.[i] ?? DEFAULT_COL_WIDTH
  );
  const colAligns: ColumnAlign[] = Array.from({ length: numCols }, (_, i) =>
    tableData.colAligns?.[i] ?? 'left'
  );

  const cellRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
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

  const toggleHeader = useCallback(() => {
    onUpdateTable({ ...tableData, rows, colWidths, colAligns, hasHeader: !hasHeader });
  }, [rows, colWidths, colAligns, hasHeader, tableData, onUpdateTable]);

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

  const addRow = useCallback(() => addRowAfter(numRows - 1), [addRowAfter, numRows]);
  const addCol = useCallback(() => addColAfter(numCols - 1), [addColAfter, numCols]);

  // Cleanup resize on unmount
  useEffect(() => {
    return () => { resizeState.current = null; };
  }, []);

  /** Column name for menus: the header cell's text when there is one. */
  const getColLabel = (colIdx: number): string => {
    if (hasHeader && rows[0]?.[colIdx]?.trim()) return rows[0][colIdx].trim();
    return `Column ${colIdx + 1}`;
  };

  const tableWidth = colWidths.reduce((a, b) => a + b, 0) + GUTTER_WIDTH;
  const showEdges = tableHovered || isFocused;

  // Idle icon buttons inside the grid: faint, tinted on hover, revealed on hover
  // or keyboard focus, and kept visible while their menu is open.
  const gridButton = cn(
    'flex items-center justify-center rounded-[7px] text-a-faint transition-[opacity,background-color,color] duration-150',
    'hover:bg-[color-mix(in_srgb,var(--a-ink)_9%,transparent)] hover:text-a-ink',
    'focus-visible:opacity-100 data-[state=open]:opacity-100',
  );

  return (
    // Padding reserves room for the edge "+" buttons outside the grid's border,
    // so they are not clipped by the grid's rounded overflow.
    <div
      className="relative w-fit max-w-full pr-[34px] pb-[32px]"
      onClick={() => onFocus(block.id)}
      onMouseEnter={() => setTableHovered(true)}
      onMouseLeave={() => setTableHovered(false)}
    >
      <div className="overflow-x-auto rounded-[16px] border border-a-line bg-a-bg">
        <table className="border-collapse" style={{ tableLayout: 'fixed', width: tableWidth }}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            <col style={{ width: GUTTER_WIDTH }} />
          </colgroup>

          <tbody>
            {rows.map((row, rowIdx) => {
              const isHeader = hasHeader && rowIdx === 0;
              const isFirstRow = rowIdx === 0;
              const isLastRow = rowIdx === numRows - 1;
              const isRowHovered = hoveredRow === rowIdx;

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
                    const align = colAligns[colIdx];

                    return (
                      <td
                        key={colIdx}
                        className={cn(
                          'group/cell relative p-0 align-top border-a-line-soft transition-colors duration-100',
                          // Internal rules only — none on the last row or last data column.
                          colIdx < numCols - 1 && 'border-r',
                          !isLastRow && 'border-b',
                          isHeader ? 'bg-a-surface' : isRowHovered && 'bg-a-row-hover',
                        )}
                      >
                        {isSelected && (
                          <div className="pointer-events-none absolute inset-0 z-10 shadow-[inset_0_0_0_1.5px_var(--a-accent)]" />
                        )}

                        {/* Column menu, on the first row's cells. */}
                        {isFirstRow && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                className={cn(gridButton, 'absolute right-1.5 top-[9px] z-20 size-5 opacity-0 group-hover/cell:opacity-100')}
                                aria-label={`Options for ${getColLabel(colIdx)}`}
                              >
                                <ChevronDown className="size-3" strokeWidth={2.75} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-52">
                              <DropdownMenuLabel className="truncate">{getColLabel(colIdx)}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => addColBefore(colIdx)}>
                                <ArrowLeft className="size-3.5" /> Insert left
                              </DropdownMenuItem>
                              <DropdownMenuItem onMouseDown={(e) => e.preventDefault()} onClick={() => addColAfter(colIdx)}>
                                <ArrowRight className="size-3.5" /> Insert right
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {(['left', 'center', 'right'] as ColumnAlign[]).map((a) => (
                                <DropdownMenuItem
                                  key={a}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => setColAlign(colIdx, a)}
                                  className={cn(align === a && 'bg-accent')}
                                >
                                  {a === 'left' && <AlignLeft className="size-3.5" />}
                                  {a === 'center' && <AlignCenter className="size-3.5" />}
                                  {a === 'right' && <AlignRight className="size-3.5" />}
                                  <span className="capitalize">Align {a}</span>
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
                              {/* Was a toolbar button. */}
                              <DropdownMenuCheckboxItem
                                checked={hasHeader}
                                onMouseDown={(e) => e.preventDefault()}
                                onCheckedChange={toggleHeader}
                              >
                                Header row
                              </DropdownMenuCheckboxItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => deleteColumn(colIdx)}
                                disabled={numCols <= 1}
                              >
                                <Trash2 className="size-3.5" /> Delete column
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}

                        {/* Resize handle on the column's right edge. */}
                        <div
                          className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize transition-colors duration-100 hover:bg-a-accent/40 active:bg-a-accent/60"
                          onMouseDown={(e) => startResize(e, colIdx)}
                          aria-hidden
                        />

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
                            'block w-full resize-none overflow-hidden border-none bg-transparent px-4 py-[11px] outline-none',
                            'placeholder:text-a-faint/60',
                            isHeader
                              ? 'text-[12.5px] font-bold leading-[1.45] tracking-[0.04em] text-a-faint'
                              : 'text-[15px] leading-[1.45] text-a-ink',
                            // Leave room for the column menu on first-row cells.
                            isFirstRow && 'pr-8',
                            align === 'center' && 'text-center',
                            align === 'right' && 'text-right tabular-nums',
                          )}
                          placeholder={isHeader ? (colIdx === 0 ? 'Column name…' : `Column ${colIdx + 1}`) : ''}
                          aria-label={`Row ${rowIdx + 1}, ${getColLabel(colIdx)}`}
                          style={{ height: 'auto', minHeight: '34px' }}
                        />
                      </td>
                    );
                  })}

                  {/* Row menu gutter */}
                  <td className={cn('p-0 align-middle', isHeader ? 'bg-a-surface' : isRowHovered && 'bg-a-row-hover')}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          className={cn(gridButton, 'mx-1 size-6 opacity-0 group-hover/row:opacity-100')}
                          aria-label={`Options for row ${rowIdx + 1}`}
                        >
                          <MoreHorizontal className="size-3.5" strokeWidth={2.75} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel>Row {rowIdx + 1}</DropdownMenuLabel>
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
                          variant="destructive"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => deleteRow(rowIdx)}
                          disabled={numRows <= 1}
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

      {/* Edge add buttons: centred on the grid's right and bottom edges. */}
      <div className="pointer-events-none absolute top-0 right-0 bottom-[32px] flex w-[26px] items-center justify-center">
        <EdgeAddButton visible={showEdges} label="Add column" onClick={addCol} />
      </div>
      <div className="pointer-events-none absolute left-0 right-[34px] bottom-0 flex h-[26px] items-center justify-center">
        <EdgeAddButton visible={showEdges} label="Add row" onClick={addRow} />
      </div>
    </div>
  );
}

function EdgeAddButton({ visible, label, onClick }: { visible: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-[22px] items-center justify-center rounded-full bg-a-surface text-a-faint shadow-[var(--a-shadow-sm)]',
        'transition-[opacity,color] duration-150 hover:text-a-ink',
        // Reachable by keyboard even while visually hidden.
        visible ? 'pointer-events-auto opacity-100' : 'opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100',
      )}
    >
      <Plus className="size-[13px]" strokeWidth={2.75} />
    </button>
  );
}
