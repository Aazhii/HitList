import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { StatusIcon } from '@/components/ui/status-icon';
import { cn } from '@/lib/utils';
import { getCategoryConfig, QUADRANTS } from '@/types/todo';
import type { Todo, TodoStatus, Quadrant } from '@/types/todo';
import { bucketByQuadrant, type TaskCompare } from '@/lib/quadrantBuckets';
import { DUE_TONE_CLASS, dueTone, getDueInfo } from '@/lib/dueInfo';
import { NEXT_STATUS } from '@/lib/taskStatus';
import { FieldChips } from '@/components/fields/FieldChips';
import type { FieldDef, FieldValue, TaskFieldValues } from '@/types/fields';

const FIELD_CHIP = 'inline-flex items-center gap-1 rounded-[6px] px-2 py-[3px] text-[12px] leading-none whitespace-nowrap';

interface EisenhowerMatrixProps {
  todos: Todo[];
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onAddToQuadrant: (quadrant: Quadrant) => void;
  nextId: string | null;
  showDone: boolean;
  /** Order within each quadrant; the manual order when absent. */
  compare?: TaskCompare;
  onToggleReminder?: (id: string, enabled: boolean) => void;
  notificationPermission?: NotificationPermission;
  /** Opens the note a task was added from. */
  onOpenNote?: (noteId: string) => void;
  fieldDefs?: FieldDef[];
  fieldValues?: TaskFieldValues;
}

/**
 * The Eisenhower matrix: four quadrant panels — a white card with a tinted
 * header bar, flat rows below (not cards on a tint), matching the reference's
 * `showMatrix` block exactly (`background:#fff` panel, `background:{{q.bg}}`
 * header only).
 */
export function EisenhowerMatrix({
  todos,
  onStatusChange,
  onDelete,
  onOpen,
  onAddToQuadrant,
  nextId,
  showDone,
  onOpenNote,
  compare,
  fieldDefs,
  fieldValues,
}: EisenhowerMatrixProps) {
  const todosByQuadrant = useMemo(
    () => bucketByQuadrant(todos, showDone, compare),
    [todos, showDone, compare],
  );

  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 md:grid-cols-2 animate-fade-in">
      {QUADRANTS.map((q) => {
        const all = todos.filter((t) => t.quadrant === q.id);
        const quadrantTodos = todosByQuadrant.get(q.id) ?? [];
        const doneCount = all.length - all.filter((t) => t.status !== 'done').length;
        const doneNote = doneCount && !showDone ? `${doneCount} completed · hidden` : '';
        const headingId = `matrix-quadrant-${q.id}`;

        return (
          <section
            key={q.id}
            aria-labelledby={headingId}
            className="flex min-h-[240px] flex-col overflow-hidden rounded-[8px] border border-a-line bg-a-surface"
          >
            <header className={cn('flex items-center gap-2 border-b border-a-line-soft px-4 py-2.5', q.tintClass)}>
              <span className={cn('size-2 flex-shrink-0 rounded-full', q.dotClass)} aria-hidden />
              <h2 id={headingId} className={cn('text-[13px] font-bold leading-none', q.inkClass)}>
                {q.label}
              </h2>
              <span className={cn('hidden truncate text-[12px] leading-none opacity-80 sm:inline', q.inkClass)}>
                {q.subtitle}
              </span>
              <span className="flex-1" />
              <span className={cn('font-mono text-[11px] leading-none', q.inkClass)}>
                {all.length - doneCount}
                <span className="sr-only"> tasks</span>
              </span>
              <button
                type="button"
                onClick={() => onAddToQuadrant(q.id)}
                aria-label={`Add task to ${q.label}`}
                className={cn(
                  'flex size-7 flex-shrink-0 items-center justify-center rounded-[6px] transition-colors duration-[120ms]',
                  'hover:bg-[color-mix(in_srgb,var(--a-ink)_9%,transparent)]',
                  q.inkClass,
                )}
              >
                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            </header>

            <div className="flex flex-1 flex-col">
              {quadrantTodos.length === 0 ? (
                <div className="mx-4 my-3 rounded-[8px] border border-dashed border-a-line py-3.5 text-center text-[13px] text-a-faint">
                  Nothing here. Add a task to {q.label}.
                </div>
              ) : (
                quadrantTodos.map((todo, i) => (
                  <MatrixRow
                    key={todo.id}
                    todo={todo}
                    isNext={todo.id === nextId}
                    onStatusChange={onStatusChange}
                    onDelete={onDelete}
                    onOpen={onOpen}
                    onOpenNote={onOpenNote}
                    fieldDefs={fieldDefs}
                    fieldValues={fieldValues?.[todo.id]}
                    index={i}
                  />
                ))
              )}

              {doneNote && (
                <div className="mt-auto border-t border-a-line-soft px-4 py-2 text-[12px] text-a-faint">
                  {doneNote}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface MatrixRowProps {
  todo: Todo;
  isNext: boolean;
  index: number;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onOpenNote?: (noteId: string) => void;
  fieldDefs?: FieldDef[];
  fieldValues?: Record<string, FieldValue>;
}

/**
 * One task inside a quadrant panel: a flat row, not a card — the reference's
 * `showMatrix` task template (`padding:9px 16px`, border-bottom between rows,
 * a status icon rather than the shared squircle `StatusBox`, title on its own
 * line with due/category/note on a second 12px line below it).
 */
function MatrixRow({ todo, isNext, index, onStatusChange, onDelete, onOpen, onOpenNote, fieldDefs, fieldValues }: MatrixRowProps) {
  const isDone = todo.status === 'done';
  const next = NEXT_STATUS[todo.status];
  const category = getCategoryConfig(todo.category);
  const dueInfo = !isDone ? getDueInfo(todo.dueDate, todo.dueTime) : null;
  const fromNote = !!todo.sourceNoteId && !!onOpenNote;
  const hasFieldChips = !!fieldDefs && !!fieldValues
    && fieldDefs.some((f) => f.showOnCard && fieldValues[f.id] !== undefined);
  const hasMeta = !!category || !!dueInfo || fromNote || hasFieldChips;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(todo)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(todo); }
      }}
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
      className="group flex cursor-pointer items-center gap-2.5 border-b border-a-line-soft px-4 py-[9px] transition-colors duration-[120ms] last:border-b-0 hover:bg-a-bg animate-slide-up"
      aria-label={`Open task: ${todo.text}`}
    >
      <StatusIcon
        status={todo.status}
        label={todo.text}
        disabled={!next}
        onClick={(e) => { e.stopPropagation(); if (next) onStatusChange(todo.id, next); }}
      />

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-[13px] font-medium leading-normal',
            isDone ? 'text-a-faint line-through decoration-[1.5px]' : 'text-a-ink',
          )}
        >
          {todo.text}
        </p>

        {hasMeta && (
          <div className="mt-[3px] flex flex-wrap items-center gap-2 text-[12px]">
            {dueInfo && (
              <span className={cn("whitespace-nowrap", DUE_TONE_CLASS[dueTone(dueInfo)])}>
                {dueInfo.label}
              </span>
            )}
            {category && <CategoryTag category={category} />}
            {fieldDefs && <FieldChips fields={fieldDefs} values={fieldValues} chipClass={FIELD_CHIP} />}
            {fromNote && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenNote!(todo.sourceNoteId!); }}
                title="Open the note this came from"
                aria-label={`Open the note “${todo.text}” came from`}
                className="inline-flex items-center gap-1 text-a-accent-700 transition-opacity duration-[120ms] hover:opacity-75"
              >
                Note
              </button>
            )}
          </div>
        )}
      </div>

      {isNext && !isDone && (
        // design-check-ignore: pill — the DS Badge is a pill (showcase 210).
        <span className="flex-shrink-0 rounded-full bg-a-blue-tint px-2 py-[3px] text-[11px] font-semibold leading-none text-a-accent-700">
          Next up
        </span>
      )}
    </div>
  );
}

function CategoryTag({ category }: { category: NonNullable<ReturnType<typeof getCategoryConfig>> }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-a-surface px-2 py-[3px] text-[11px] font-medium text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]">
      <span className={cn('size-2 flex-shrink-0 rounded-[3px]', category.swatchClass)} aria-hidden />
      {category.label}
    </span>
  );
}
