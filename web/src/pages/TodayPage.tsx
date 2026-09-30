/**
 * Today (P5.1): the daily decision as the front door. One next task, large; the two after it, small;
 * everything overdue counted and one click away. The matrix and the other layouts stay under Tasks,
 * as the planning views. The ranking is `lib/today.ts`, derived from quadrant, due date and status.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TopBar, topBarPrimary, topBarSecondary, BTN_MD } from '@/components/shell/TopBar';
import { ViewLayoutContext } from '@/components/shell/ViewLayout';
import { EmptyState, ILL } from '@/components/EmptyState';
import { DUE_TONE_CLASS, dueTone, getDueInfo } from '@/lib/dueInfo';
import { greeting, planToday } from '@/lib/today';
import { getQuadrantConfig, type KaizenList, type Todo, type TodoStatus } from '@/types/todo';

export interface TodayPageProps {
  todos: Todo[];
  lists: KaizenList[];
  onStatusChange: (id: string, status: TodoStatus) => void;
  onOpenTask: (todo: Todo) => void;
  /** Goes to the Tasks view, where the matrix and the other layouts are. */
  onOpenTasks: () => void;
  onOpenSidebar?: () => void;
  /** Sits above the plan: the daily line (P5.2). */
  banner?: ReactNode;
}

function DueText({ todo }: { todo: Todo }) {
  const info = getDueInfo(todo.dueDate, todo.dueTime);
  if (!info) return null;
  return <span className={cn('text-[13px]', DUE_TONE_CLASS[dueTone(info)])}>{info.label}</span>;
}

export function TodayPage({ todos, lists, onStatusChange, onOpenTask, onOpenTasks, onOpenSidebar, banner }: TodayPageProps) {
  // The plan is time-aware (overdue, greeting), so it is recomputed each minute the page stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const plan = useMemo(() => planToday(todos, now), [todos, now]);
  const [showOverdue, setShowOverdue] = useState(false);
  const listName = (t: Todo) => lists.find((l) => l.id === t.listId)?.name;
  const date = new Date(now);
  const { next } = plan;

  return (
    <ViewLayoutContext.Provider value={{
      openContext: () => onOpenSidebar?.(),
      closeContext: () => {},
      toggleCollapsed: () => {},
      collapsible: false,
      collapsed: false,
    }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          title="Today"
          subtitle={date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          actions={(
            <button type="button" onClick={onOpenTasks} className={cn(topBarSecondary, BTN_MD)}>Plan in the matrix</button>
          )}
        />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[640px] px-4 pt-6 pb-12">
            {banner}
            {!next ? (
              <EmptyState
                image={ILL.happyMascot}
                title="Nothing left for today"
                description="Every open task is done. Add one when something comes up."
                action={<button type="button" onClick={onOpenTasks} className={cn(topBarPrimary, BTN_MD)}>Go to Tasks</button>}
              />
            ) : (
              <>
                <p className="mb-2 text-[13px] text-a-muted">{greeting(date)}. Start with this.</p>

                <section aria-label="Next task" className="rounded-[12px] border border-a-line bg-a-surface p-6 shadow-[var(--a-shadow-sm)]">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
                    <span className={cn('rounded-[3px] px-1.5 py-0.5 font-semibold', getQuadrantConfig(next.quadrant).badgeClass)}>
                      {getQuadrantConfig(next.quadrant).label}
                    </span>
                    {listName(next) && <span className="text-a-muted">{listName(next)}</span>}
                    <DueText todo={next} />
                  </div>
                  <h2 className="font-display text-[24px] font-semibold leading-[1.3] text-a-ink [overflow-wrap:anywhere]">{next.text}</h2>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {next.status === 'todo' && (
                      <button type="button" onClick={() => onStatusChange(next.id, 'in-progress')} className={cn(topBarPrimary, BTN_MD, 'gap-1.5')}>
                        <Play className="size-[14px]" strokeWidth={1.75} aria-hidden /> Start
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onStatusChange(next.id, 'done')}
                      className={cn(next.status === 'todo' ? topBarSecondary : topBarPrimary, BTN_MD, 'gap-1.5')}
                    >
                      <Check className="size-[14px]" strokeWidth={1.75} aria-hidden /> Mark done
                    </button>
                    <button type="button" onClick={() => onOpenTask(next)} className={cn(topBarSecondary, BTN_MD)}>Open</button>
                  </div>
                </section>

                {plan.after.length > 0 && (
                  <section aria-label="After that" className="mt-6">
                    <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-a-faint">After that</h3>
                    <ul>
                      {plan.after.map((t) => (
                        <li key={t.id} className="flex items-center gap-3 border-b border-a-line-soft py-2.5 last:border-b-0">
                          <button
                            type="button"
                            aria-label={`Mark "${t.text}" done`}
                            onClick={() => onStatusChange(t.id, 'done')}
                            className="flex size-[18px] flex-shrink-0 items-center justify-center rounded-[4px] border border-a-line-strong bg-a-surface transition-colors duration-[120ms] hover:border-a-accent"
                          />
                          <button type="button" onClick={() => onOpenTask(t)} className="min-w-0 flex-1 truncate text-left text-[14px] text-a-ink hover:underline">
                            {t.text}
                          </button>
                          <DueText todo={t} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-4 text-[13px]">
                  {plan.overdue.length > 0 && (
                    <button
                      type="button"
                      aria-expanded={showOverdue}
                      onClick={() => setShowOverdue((o) => !o)}
                      className="inline-flex items-center gap-1 font-semibold text-a-attention hover:underline"
                    >
                      {plan.overdue.length} overdue
                      <ChevronDown className={cn('size-[14px] transition-transform duration-[120ms]', showOverdue && 'rotate-180')} strokeWidth={1.75} aria-hidden />
                    </button>
                  )}
                  {plan.rest > 0 && (
                    <button type="button" onClick={onOpenTasks} className="inline-flex items-center gap-1 text-a-muted hover:text-a-ink">
                      {plan.rest} more open <ArrowRight className="size-[14px]" strokeWidth={1.75} aria-hidden />
                    </button>
                  )}
                </div>

                {showOverdue && (
                  <ul aria-label="Overdue tasks" className="mt-2 rounded-[8px] bg-a-line-soft p-1">
                    {plan.overdue.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => onOpenTask(t)}
                          className="flex w-full items-center gap-3 rounded-[4px] px-2.5 py-2 text-left transition-colors duration-[120ms] hover:bg-a-row-hover"
                        >
                          <span className="min-w-0 flex-1 truncate text-[14px] text-a-ink">{t.text}</span>
                          <DueText todo={t} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </ViewLayoutContext.Provider>
  );
}
