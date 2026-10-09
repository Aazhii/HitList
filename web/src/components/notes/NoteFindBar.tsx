import { type RefObject } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NoteFindBarProps {
  query: string;
  matchCase: boolean;
  /** How many places match, and which one is shown (0-based; ignored when there are none). */
  count: number;
  current: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onToggleCase: () => void;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}

const BUTTON = 'flex size-7 items-center justify-center rounded-[6px] text-a-muted transition-colors duration-[120ms] hover:bg-a-row-hover hover:text-a-ink disabled:pointer-events-none disabled:opacity-40';

/** ⌘F inside a note: find text across its blocks, step through the matches, close with Esc. */
export function NoteFindBar({ query, matchCase, count, current, inputRef, onQuery, onToggleCase, onStep, onClose }: NoteFindBarProps) {
  const status = query === '' ? '' : count === 0 ? 'No results' : `${current + 1} of ${count}`;
  return (
    <div
      role="search"
      aria-label="Find in note"
      className="sticky top-2 z-30 mb-3 ml-auto flex w-fit items-center gap-1 rounded-[12px] border border-a-line bg-a-bg py-1 pl-3 pr-1 shadow-[var(--a-shadow-md)]"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        placeholder="Find in note"
        aria-label="Find in note"
        spellCheck={false}
        className="w-[180px] bg-transparent text-[13px] text-a-ink outline-none placeholder:text-a-faint"
      />
      <span aria-live="polite" className="min-w-[56px] text-right text-[12px] tabular-nums text-a-faint">{status}</span>
      <button
        type="button"
        onClick={onToggleCase}
        aria-pressed={matchCase}
        title="Match case"
        aria-label="Match case"
        className={cn(BUTTON, 'text-[12px] font-semibold', matchCase && 'bg-a-accent-tint text-a-accent-700')}
      >
        Aa
      </button>
      <button type="button" onClick={() => onStep(-1)} disabled={count === 0} title="Previous (Shift+Enter)" aria-label="Previous match" className={BUTTON}>
        <ChevronUp className="size-4" strokeWidth={1.75} />
      </button>
      <button type="button" onClick={() => onStep(1)} disabled={count === 0} title="Next (Enter)" aria-label="Next match" className={BUTTON}>
        <ChevronDown className="size-4" strokeWidth={1.75} />
      </button>
      <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close find" className={BUTTON}>
        <X className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
