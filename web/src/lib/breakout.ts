/**
 * A block inside a note sits in a narrow reading column. A database should instead run as wide as the page's content, like
 * the Databases page, so it does not scroll sideways inside a small box. `breakoutBox` works out how wide that is and how far
 * left of the column it starts. Pure: positions come from getBoundingClientRect, measured by the caller.
 */
export interface BreakoutInput {
  /** The page's outer left edge and width, and its horizontal padding (what the content may not use). */
  pageLeft: number;
  pageWidth: number;
  padLeft: number;
  padRight: number;
  /** Where the block would start if it stayed in the column. */
  columnLeft: number;
  /** The column's own width: a block is never narrower than this. */
  columnWidth: number;
  /** Space kept free on the left of the wide block, for the controls that hang beside every block (44px). */
  inset?: number;
}

export function breakoutBox(i: BreakoutInput): { width: number; left: number } {
  const inset = i.inset ?? 0;
  const contentLeft = i.pageLeft + i.padLeft + inset;
  const contentWidth = Math.max(0, i.pageWidth - i.padLeft - i.padRight - inset);
  const width = Math.max(contentWidth, i.columnWidth);
  // Never start right of the column: a page narrower than the column keeps the block where it is.
  const left = Math.min(0, contentLeft - i.columnLeft);
  return { width, left };
}
