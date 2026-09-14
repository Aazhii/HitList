import { useMemo } from 'react';
import { Plus, Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
}

function QuadrantEmptyState({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center animate-fade-in">
      <span className="text-2xl mb-2 opacity-60">{icon}</span>
      <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-[140px]">
        No tasks here yet
      </p>
    </div>
  );
}

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
}: EisenhowerMatrixProps) {
  const todosByQuadrant = useMemo(() => bucketByQuadrant(todos, showDone), [todos, showDone]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
      {QUADRANTS.map((q) => {
        const quadrantTodos = todosByQuadrant.get(q.id) ?? [];
        const activeCount = quadrantTodos.filter((t) => t.status !== 'done').length;

        return (
          <div
            key={q.id}
            className={cn(
              'flex flex-col rounded-2xl border overflow-hidden transition-shadow duration-200',
              q.accentClass,
              q.bgClass
            )}
          >
            {/* Quadrant header */}
            <div
              className={cn(
                'flex items-center justify-between px-4 py-3 border-b',
                q.headerClass
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{q.label}</span>
                    {activeCount > 0 && (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums min-w-[18px]',
                          q.badgeClass
                        )}
                      >
                        {activeCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                        q.isUrgent
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {q.urgentLabel}
                    </span>
                    <span className="text-[9px] text-muted-foreground/40">·</span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                        q.isImportant
                          ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {q.importantLabel}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onAddToQuadrant(q.id)}
                aria-label={`Add task to ${q.label}`}
                className="size-7 flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors duration-150"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>

            {/* Task list */}
            <div className="flex-1 p-3 space-y-2 min-h-[120px]">
              {quadrantTodos.length === 0 ? (
                <QuadrantEmptyState icon={q.emptyIcon} label={q.label} />
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
                    index={i}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
