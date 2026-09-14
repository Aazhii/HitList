/**
 * Rendered inline formatting for a block that is not being edited.
 *
 * A block containing marks shows this while unfocused and its raw textarea
 * while focused — see NoteEditor's BlockRow. The textarea stays in the DOM the
 * whole time, stacked underneath, so it remains in the tab order and every
 * keyboard behaviour of the editor is exactly what it was.
 *
 * Clicking the rendered text focuses the textarea with the caret where the user
 * clicked, mapped back through the delimiters. Without that, clicking into the
 * middle of a bold word would drop the caret at the end of the block.
 */
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  parseInline,
  sourceOffsetFromRendered,
  stripInline,
  type InlineRun,
  type Mark,
} from '@/lib/inlineMarkdown';
import type { BlockType } from '@/types/notes';

/**
 * Which marks a block type can carry.
 *
 * Code is exempt — its `*` and `~` are literal. Display-face headings cannot be
 * bold: Caprasimo ships one weight, and a synthesised bold on it is exactly the
 * faux weight the design system rules out. Offering a Bold button that visibly
 * does nothing would be the dead-toolbar problem again, so it is not offered.
 */
export function supportedMarks(type: BlockType): readonly Mark[] {
  switch (type) {
    case 'code':
    case 'divider':
    case 'table':
      return [];
    case 'heading1':
    case 'heading2':
      return ['italic', 'underline', 'strike'];
    default:
      return ['bold', 'italic', 'underline', 'strike'];
  }
}

function RunView({ run }: { run: InlineRun }) {
  let node: ReactNode = run.text;
  // Innermost first, so the nesting matches MARKS order from the outside in.
  if (run.marks.includes('strike')) node = <s className="decoration-[1.5px]">{node}</s>;
  if (run.marks.includes('underline')) node = <u className="decoration-[1.5px] underline-offset-[3px]">{node}</u>;
  if (run.marks.includes('italic')) node = <em>{node}</em>;
  if (run.marks.includes('bold')) node = <strong className="font-bold">{node}</strong>;
  return <>{node}</>;
}

/** Offset into the element's rendered text at a viewport point, or null. */
function renderedOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; offset = pos.offset; }
  } else if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y);
    if (range) { node = range.startContainer; offset = range.startOffset; }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;

  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === node) return count + offset;
    count += n.textContent?.length ?? 0;
  }
  return null;
}

export interface InlineTextHandle {
  element: HTMLDivElement | null;
}

interface InlineTextProps {
  text: string;
  className?: string;
  /** Called with the SOURCE offset the caret should go to. */
  onActivate: (sourceOffset: number) => void;
}

export const InlineText = forwardRef<InlineTextHandle, InlineTextProps>(function InlineText(
  { text, className, onActivate },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ element: rootRef.current }), []);

  return (
    <div
      ref={rootRef}
      // Presentational: the textarea underneath is the real, focusable control.
      aria-hidden
      className={cn('whitespace-pre-wrap break-words cursor-text', className)}
      onMouseDown={(e) => {
        // Keep the browser from starting a text selection on the rendered copy.
        e.preventDefault();
        const root = rootRef.current;
        const rendered = root ? renderedOffsetAtPoint(root, e.clientX, e.clientY) : null;
        onActivate(sourceOffsetFromRendered(text, rendered ?? stripInline(text).length));
      }}
    >
      {parseInline(text).map((run, i) => <RunView key={i} run={run} />)}
    </div>
  );
});
