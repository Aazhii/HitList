/**
 * The editor's type scale, and every vertical offset derived from it.
 *
 * The gutter controls and list markers are centred on a block's first line.
 * Those offsets used to be three hand-kept pixel tables next to the type scale,
 * so changing a font size silently misaligned the markers. Now each offset is
 * computed from the one table below, and a test checks the text classes still
 * say the same thing.
 *
 * Every number is the prototype's (showcase 310–354, measured): body 14px, the
 * headings 24/20/16 at weight 600, quote 15, code 12.
 */
import type { BlockType } from '@/types/notes';

export interface BlockMetric {
  /** px */
  fontSize: number;
  /** Unitless multiplier, as in `leading-[n]`. */
  lineHeight: number;
  /** px of panel or row padding above the first line, measured from the row's top. */
  insetTop: number;
}

const BODY: BlockMetric = { fontSize: 14, lineHeight: 1.65, insetTop: 0 };
/** A list item: the prototype sets a whole list at 1.8 with no space between items. */
const LIST: BlockMetric = { fontSize: 14, lineHeight: 1.8, insetTop: 0 };

export const BLOCK_METRICS: Record<BlockType, BlockMetric> = {
  paragraph: BODY,
  bullet:    LIST,
  numbered:  LIST,
  // py-1 row around a 1.5 line.
  todo:      { fontSize: 14, lineHeight: 1.5, insetTop: 4 },
  heading1:  { fontSize: 24, lineHeight: 1.2, insetTop: 0 },
  heading2:  { fontSize: 20, lineHeight: 1.2, insetTop: 0 },
  heading3:  { fontSize: 16, lineHeight: 1.2, insetTop: 0 },
  // py-[2px] between the rule's ends.
  quote:     { fontSize: 15, lineHeight: 1.6, insetTop: 2 },
  // py-[14px] panel
  code:      { fontSize: 12, lineHeight: 1.7, insetTop: 14 },
  // py-3 panel
  callout:   { fontSize: 14, lineHeight: 1.55, insetTop: 12 },
  // The DS Table cell: py-2 around 13px / 1.5 text → a 36px row.
  table:     { fontSize: 13, lineHeight: 1.5, insetTop: 8 },
  // Not text: a 24px box with the rule through its middle.
  divider:   { fontSize: 24, lineHeight: 1,    insetTop: 0 },
  // Not text: an inline database, whose header row is 28px tall.
  database:  { fontSize: 16, lineHeight: 1.75, insetTop: 0 },
};

/** Size of each gutter control button (the DS small IconButton, 28px). */
export const CONTROL_SIZE = 28;

/**
 * The column a marker (bullet, number, to-do box, callout icon) sits in, and the space before the
 * text. Lists put text at 22px, to-dos at 26 (16 + 10), callouts 12px after an 18px icon.
 */
export const MARKERS = {
  todo:     { col: 16, gap: 10 },
  bullet:   { col: 22, gap: 0 },
  numbered: { col: 22, gap: 0 },
  callout:  { col: 18, gap: 12 },
} as const;

/** The marker column. Literal so Tailwind sees it; the test checks it against MARKERS. */
export function markerBoxClass(type: keyof typeof MARKERS): string {
  switch (type) {
    case 'todo':     return 'mr-[10px] flex w-[16px] flex-shrink-0 justify-center';
    case 'callout':  return 'mr-[12px] flex w-[18px] flex-shrink-0 justify-center';
    default:         return 'mr-[0px] flex w-[22px] flex-shrink-0 justify-center';
  }
}

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
 * Text classes per block type. Headings are the body face at 600 — there is no display face in
 * the prototype's notes. Colour is the prototype's: body text, list items and the quote are
 * secondary; to-dos, callouts, code and headings are ink.
 */
export function getBlockTextClass(type: BlockType): string {
  switch (type) {
    case 'heading1': return 'text-[24px] leading-[1.2] font-semibold tracking-[-0.01em] text-a-ink';
    case 'heading2': return 'text-[20px] leading-[1.2] font-semibold tracking-[-0.01em] text-a-ink';
    case 'heading3': return 'text-[16px] leading-[1.2] font-semibold tracking-[-0.01em] text-a-ink';
    // design-check-ignore: font-size — showcase 355 sets the blockquote at 15px.
    case 'quote':    return 'text-[15px] leading-[1.6] text-a-muted';
    case 'code':     return 'font-mono text-[12px] leading-[1.7] text-a-code-ink';
    // Colour comes from the callout's tone; see BlockRow.
    case 'callout':  return 'text-[14px] leading-[1.55]';
    case 'table':    return 'text-[13px] leading-[1.5] text-a-ink';
    case 'todo':     return 'text-[14px] leading-[1.5] text-a-ink';
    case 'bullet':
    case 'numbered': return 'text-[14px] leading-[1.8] text-a-muted';
    case 'divider':
    case 'database': return '';
    default:         return 'text-[14px] leading-[1.65] text-a-muted';
  }
}
