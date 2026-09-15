import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MatrixTaskCard } from '@/components/MatrixTaskCard';
import { QUADRANTS } from '@/types/todo';
import type { Todo, TodoStatus, Quadrant } from '@/types/todo';
import { bucketByQuadrant } from '@/lib/quadrantBuckets';

interface EisenhowerMatrixProps {
  todos: Todo[];
  onStatusChange: (id: string, status: TodoStatus) => void;
  onDelete: (id: string) => void;
  onOpen: (todo: Todo) => void;
  onAddToQuadrant: (quadrant: Quadrant) => void;
  nextId: string | null;
  showDone: boolean;
  onToggleReminder?: (id: string, enabled: boolean) => void;
  notificationPermission?: NotificationPermission;
  /** Opens the note a task was added from. */
  onOpenNote?: (noteId: string) => void;
}

/**
 * The Eisenhower matrix: four quadrant panels, each filled with its own tint.
 *
 * Every panel ends in an "Add here" row, which replaces the small "+" that used
 * to sit in each header. The urgent / important micro-badges are gone — the
 * subtitle says the same thing in words.
 */
export function EisenhowerMatrix({
  todos,
  onStatusChange,
  onDelete,
  onOpen,
  onAddToQuadrant,
  nextId,
  showDone,
  onToggleReminder,
  notificationPermission,
  onOpenNote,
}: EisenhowerMatrixProps) {
  const todosByQuadrant = useMemo(() => bucketByQuadrant(todos, showDone), [todos, showDone]);

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 animate-fade-in">
      {QUADRANTS.map((q) => {
        const quadrantTodos = todosByQuadrant.get(q.id) ?? [];
        const openCount = quadrantTodos.filter((t) => t.status !== 'done').length;
        const headingId = `matrix-quadrant-${q.id}`;

        return (
          <section
            key={q.id}
            aria-labelledby={headingId}
            className={cn('flex flex-col gap-[9px] overflow-hidden rounded-[24px] px-5 py-[18px]', q.tintClass)}
          >
            <header className="flex items-center gap-2">
              <span className="text-[15px] leading-none" aria-hidden>{q.emptyIcon}</span>
              <h2 id={headingId} className={cn('font-display text-[19px] leading-tight', q.inkClass)}>
                {q.label}
              </h2>
              <span className={cn('hidden truncate text-[12px] opacity-75 sm:inline', q.inkClass)}>
                {q.subtitle}
              </span>
              <span className={cn('ml-auto text-[13px] font-bold tabular-nums', q.inkClass)}>
                {openCount}
                <span className="sr-only"> open</span>
              </span>
            </header>

            {quadrantTodos.length === 0 ? (
              // The quadrant's name is deliberately not repeated here: the header
              // above already says it.
              <p className={cn('px-1 py-2 text-[13.5px] opacity-70', q.inkClass)}>Nothing here yet</p>
            ) : (
              quadrantTodos.map((todo, i) => (
                <MatrixTaskCard
                  key={todo.id}
                  todo={todo}
                  isNext={todo.id === nextId}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onOpen={onOpen}
                  onToggleReminder={onToggleReminder}
                  notificationPermission={notificationPermission}
                  onOpenNote={onOpenNote}
                  index={i}
                />
              ))
            )}

            <button
              type="button"
              onClick={() => onAddToQuadrant(q.id)}
              aria-label={`Add task to ${q.label}`}
              className={cn(
                'flex items-center gap-[9px] rounded-[14px] px-3.5 py-2 text-left text-[13.5px] transition-colors duration-150 hover:bg-a-bg/60',
                q.inkClass,
                q.ringClass,
              )}
            >
              <Plus className="size-3.5" strokeWidth={2.75} aria-hidden />
              Add here
            </button>
          </section>
        );
      })}
    </div>
  );
}
