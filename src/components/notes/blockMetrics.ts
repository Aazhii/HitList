/**
 * The editor's type scale, and every vertical offset derived from it.
 *
 * The gutter controls and list markers are centred on a block's first line.
 * Those offsets used to be three hand-kept pixel tables next to the type scale,
 * so changing a font size silently misaligned the markers. Now each offset is
 * computed from the one table below, and a test checks the text classes still
 * say the same thing.
 */
import type { BlockType } from '@/types/notes';

export interface BlockMetric {
  /** px */
  fontSize: number;
  /** Unitless multiplier, as in `leading-[n]`. */
  lineHeight: number;
  /** px of panel or cell padding above the first line, measured from the row's top. */
  insetTop: number;
}

const BODY: BlockMetric = { fontSize: 16.5, lineHeight: 1.68, insetTop: 0 };

export const BLOCK_METRICS: Record<BlockType, BlockMetric> = {
  paragraph: BODY,
  bullet:    BODY,
  numbered:  BODY,
  todo:      BODY,
  heading1:  { fontSize: 34,   lineHeight: 1.12, insetTop: 0 },
  heading2:  { fontSize: 27,   lineHeight: 1.2,  insetTop: 0 },
  heading3:  { fontSize: 19,   lineHeight: 1.35, insetTop: 0 },
  quote:     { fontSize: 17,   lineHeight: 1.6,  insetTop: 0 },
  // py-4 panel
  code:      { fontSize: 13.5, lineHeight: 1.7,  insetTop: 16 },
  callout:   { fontSize: 15.5, lineHeight: 1.62, insetTop: 16 },
  // The header row: py-[11px] cells around 15px / 1.45 text → a 43.75px row.
  table:     { fontSize: 15,   lineHeight: 1.45, insetTop: 11 },
  // Not text: a 24px box with the rule through its middle.
  divider:   { fontSize: 24,   lineHeight: 1,    insetTop: 0 },
};

/** Size of each gutter control button. */
export const CONTROL_SIZE = 22;

/** Width of the marker column (bullet, number, to-do box, callout emoji). */
export const MARKER_COL = 26;
/** Space between the marker column and the text: marked text starts at 28px. */
export const MARKER_GAP = 2;

/** The marker column. Literal so Tailwind sees it; the test checks it against the numbers. */
export const MARKER_BOX_CLASS = 'mr-[2px] flex w-[26px] flex-shrink-0 justify-center';

/** Distance from a block's first text line top to that line's centre. */
export function lineCentre(type: BlockType): number {
  const m = BLOCK_METRICS[type];
  return (m.fontSize * m.lineHeight) / 2;
}

/** `top` for the gutter controls, relative to the row. */
export function controlsTop(type: BlockType): number {
  return Math.round(BLOCK_METRICS[type].insetTop + lineCentre(type) - CONTROL_SIZE / 2);
}

/** `margin-top` for a marker of `size` px, relative to the text's own box. */
export function markerTop(type: BlockType, size: number): number {
  return Math.round(lineCentre(type) - size / 2);
}

/**
 * Text classes per block type. H1 and H2 use the display face, which has one
 * weight — never bold it. Quote is not italic or muted: that made it the least
 * readable text on the page.
 */
export function getBlockTextClass(type: BlockType): string {
  switch (type) {
    case 'heading1': return 'font-display text-[34px] leading-[1.12] tracking-[-0.015em] text-a-ink';
    case 'heading2': return 'font-display text-[27px] leading-[1.2] tracking-[-0.01em] text-a-ink';
    case 'heading3': return 'text-[19px] leading-[1.35] font-bold text-a-ink';
    case 'quote':    return 'text-[17px] leading-[1.6] text-a-ink';
    case 'code':     return 'font-mono text-[13.5px] leading-[1.7] text-a-ink';
    // Colour comes from the callout's tone; see BlockRow.
    case 'callout':  return 'text-[15.5px] leading-[1.62]';
    case 'table':    return 'text-[15px] leading-[1.45] text-a-ink';
    case 'divider':  return '';
    default:         return 'text-[16.5px] leading-[1.68] text-a-ink';
  }
}
