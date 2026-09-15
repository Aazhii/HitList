import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Plus,
  Grid2x2,
  WifiOff,
  RefreshCw,
  AlertCircle,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { NotesWorkspace } from '@/components/NotesWorkspace';
import type { NoteTaskLinking } from '@/components/NoteEditor';
import { AutomationsPage } from '@/pages/AutomationsPage';
import { useNotifications } from '@/hooks/useNotifications';
import { useInAppNotifications } from '@/hooks/useInAppNotifications';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { NotificationBell } from '@/components/NotificationBell';
import { NotificationToast } from '@/components/NotificationToast';
import { RemindersSettingsPanel } from '@/components/RemindersSettingsPanel';
import type { ReminderMinutes } from '@/lib/notifications';
import { DEFAULT_REMINDER_MINUTES, isNotificationSupported } from '@/lib/notifications';
import { Toaster, toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MomentumBar } from '@/components/MomentumBar';
import { TodayHistoryPanel } from '@/components/TodayHistoryPanel';
import { ListSidebar } from '@/components/ListSidebar';
import { StreakPanel } from '@/components/StreakPanel';
import { EisenhowerMatrix } from '@/components/EisenhowerMatrix';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import { AppShell } from '@/components/shell/AppShell';
import { IconRail, type AppView } from '@/components/shell/IconRail';
import { ViewLayout } from '@/components/shell/ViewLayout';
import { TopBar, TopBarToggle, topBarPill, topBarPrimary } from '@/components/shell/TopBar';
import { UserMenu } from '@/components/shell/UserMenu';
import { loadAppState, saveAppState, setActiveUserId } from '@/lib/storage';
import { applyTaskFilters, compareForFilters } from '@/lib/taskFilters';
import type { ReorderChange } from '@/lib/reorder';
import { useCatalystSync, apiTaskToTodo, apiListToKaizenList } from '@/hooks/useCatalystSync';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import {
  AdvancedFilterBar,
  DEFAULT_FILTERS,
  countActiveFilters,
} from '@/components/AdvancedFilterBar';
import type { FilterState } from '@/components/AdvancedFilterBar';
import { EmptyState } from '@/components/EmptyState';
import { useCatalystUser } from '@/components/CatalystAuthGate';
import type {
  Todo,
  TodoStatus,
  KaizenStats,
  KaizenList,
  AppState,
  Quadrant,
} from '@/types/todo';
import { QUADRANTS, getListColorDot, getQuadrantConfig } from '@/types/todo';

// ── Add Task Dialog (inline, lightweight) ──────────────────────────────────

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { CATEGORIES } from '@/types/todo';
import { cn } from '@/lib/utils';

interface AddTaskDialogProps {
  open: boolean;
  defaultQuadrant: Quadrant;
  onOpenChange: (v: boolean) => void;
  onAdd: (text: string, quadrant: Quadrant, category?: string, dueDate?: string, dueTime?: string) => void;
}

const FIELD_LABEL = 'text-[11px] font-bold uppercase tracking-[0.1em] text-a-faint';

function AddTaskDialog({ open, defaultQuadrant, onOpenChange, onAdd }: AddTaskDialogProps) {
  const [text, setText] = useState('');
  const [quadrant, setQuadrant] = useState<Quadrant>(defaultQuadrant);
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuadrant(defaultQuadrant);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, defaultQuadrant]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setError('Task description is required.'); return; }
    onAdd(text.trim(), quadrant, category || undefined, dueDate || undefined, dueTime || undefined);
    setText(''); setCategory(''); setDueDate(''); setDueTime(''); setError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[22px] font-normal">
            <Grid2x2 className="size-4 text-a-accent" strokeWidth={2.75} />
            Add task
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task text */}
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Task</Label>
            <Input
              ref={inputRef}
              value={text}
              onChange={(e) => { setText(e.target.value); setError(''); }}
              placeholder="What needs to be done?"
              className={cn('rounded-xl text-[15px]', error && 'border-destructive')}
              maxLength={200}
            />
            {error && <p className="text-xs text-destructive animate-fade-in">{error}</p>}
          </div>

          {/* Quadrant */}
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Priority quadrant</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Priority quadrant">
              {QUADRANTS.map((q) => {
                const selected = quadrant === q.id;
                return (
                  <button
                    key={q.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setQuadrant(q.id)}
                    className={cn(
                      'flex flex-col items-start rounded-[14px] px-3 py-2.5 text-left transition-colors duration-150',
                      selected
                        ? cn(q.tintClass, q.inkClass, 'shadow-[inset_0_0_0_1.5px_currentColor]')
                        : 'bg-a-bg text-a-ink shadow-[inset_0_0_0_1px_var(--a-line)] hover:bg-a-row-hover',
                    )}
                  >
                    <span className="text-[13px] font-semibold">{q.label}</span>
                    <span className="mt-0.5 text-[11.5px] opacity-75">{q.subtitle}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category + Due date row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Category</Label>
              <Select value={category || '__none__'} onValueChange={(v) => setCategory(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-9 w-full rounded-xl text-xs">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cat.color)}>
                        {cat.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Due date</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9 rounded-xl text-xs"
              />
            </div>
          </div>

          {/* Due time (only if date set) */}
          {dueDate && (
            <div className="space-y-1.5 animate-fade-in">
              <Label className={FIELD_LABEL}>
                Due time <span className="font-normal normal-case tracking-normal">(optional)</span>
              </Label>
              <Input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="h-9 w-36 rounded-xl text-xs"
              />
            </div>
          )}

          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 rounded-full">
              Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getTodayKey() {
  return getTodayKeyFor(Date.now());
}

function getTodayKeyFor(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── No tasks match the filters ─────────────────────────────────────────────

function NoMatchingTasks({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 text-center animate-fade-in">
      <p className="font-display text-[20px] text-a-ink">No tasks match these filters</p>
      <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-a-muted">
        Nothing in this list fits. Loosen a filter, or clear them all.
      </p>
      <button type="button" onClick={onClear} className={`${topBarPill} mt-5`}>
        Clear filters
      </button>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 animate-fade-in" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2.5 rounded-[24px] bg-a-surface px-5 py-[18px]">
          <Skeleton className="h-5 w-28 bg-a-bg" />
          {[0, 1].map((j) => (
            <Skeleton key={j} className="h-11 w-full rounded-[14px] bg-a-bg" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Error banner ───────────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry, onDismiss }: { message: string; onRetry: () => void; onDismiss: () => void }) {
  return (
    <div className="mx-4 md:mx-6 mt-4 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 flex items-center gap-3 animate-fade-in">
      <AlertCircle className="size-4 text-destructive flex-shrink-0" />
      <p className="text-sm text-destructive flex-1 min-w-0 truncate">{message}</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="h-7 px-2.5 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
      >
        <RefreshCw className="size-3" />
        Retry
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDismiss}
        className="size-7 text-muted-foreground hover:text-foreground flex-shrink-0"
        aria-label="Dismiss error"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  // ── Scope storage to the signed-in user ──────────────────────────────────
  const { session } = useCatalystUser();

  // ── Organic theme ────────────────────────────────────────────────────────
  // On <html>, not on App's root element: sheets, dialogs, menus, popovers and
  // the toaster portal into document.body, outside this tree, and would render
  // unthemed. The login page never mounts App, so it keeps its own theme.
  useEffect(() => {
    document.documentElement.classList.add('app-organic');
    return () => document.documentElement.classList.remove('app-organic');
  }, []);

  // ── localStorage state scoped to the signed-in user ──────────────────────
  const [appState, setAppState] = useState<AppState>(() => {
    // setActiveUserId is synchronous — set it before the first loadAppState call
    setActiveUserId(session?.userId ?? null);
    return loadAppState();
  });

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterState, setFilterState] = useState<FilterState>(DEFAULT_FILTERS);

  // ── Server sync ───────────────────────────────────────────────────────────
  const server = useCatalystSync(appState.activeListId);

  // Persist to localStorage whenever appState changes (offline fallback)
  useEffect(() => {
    saveAppState(appState);
  }, [appState]);

  // Track whether we've received the first non-loading server response.
  // This lets us distinguish "server returned empty" from "server hasn't responded yet".
  const serverLoadedRef = useRef(false);

  // Merge server/mock data into appState whenever the hook returns fresh data.
  // Runs for both online (real server) and offline (mock API) modes.
  useEffect(() => {
    if (server.loading) return;

    // Mark that we've received at least one server response
    serverLoadedRef.current = true;

    const { tasks: apiTasks, lists: apiLists, momentum } = server;

    setAppState((prev) => {
      const serverLists: KaizenList[] = apiLists.map(apiListToKaizenList);
      const serverTodos: Todo[]       = apiTasks.map(apiTaskToTodo);
      const serverStats: KaizenStats  = momentum
        ? { streak: momentum.streak, totalCompleted: momentum.totalCompleted, todayCompleted: momentum.todayCompleted }
        : prev.stats;

      // Always use local mock data — keep conditional merge so the app
      // remains usable with local seed data when no tasks exist yet.
      const mergedLists = serverLists.length > 0 ? serverLists : prev.lists;

      const validListIds = new Set(mergedLists.map((l) => l.id));
      const newActiveId  = validListIds.has(prev.activeListId)
        ? prev.activeListId
        : (mergedLists[0]?.id ?? prev.activeListId);

      return {
        ...prev,
        lists:        mergedLists,
        // Always replace todos with server data once loaded (even if empty — user may have no tasks)
        todos:        serverTodos,
        stats:        serverStats,
        activeListId: newActiveId,
      };
    });
  }, [server.tasks, server.lists, server.momentum, server.loading]);

  const { lists, activeListId, todos, stats } = appState;

  // UI state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultQuadrant, setDefaultQuadrant] = useState<Quadrant>('do');
  const [showStreak, setShowStreak] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showTodayHistory, setShowTodayHistory] = useState(false);
  const [defaultReminderMinutes, setDefaultReminderMinutes] = useState<ReminderMinutes>(DEFAULT_REMINDER_MINUTES);
  const [activeView, setActiveView] = useState<AppView>('tasks');
  /** A note to open once Notes mounts — set from a task's "Note" chip. */
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  /** A task to write an escalation rule for — set from the task detail panel. */
  const [pendingEscalationTaskId, setPendingEscalationTaskId] = useState<string | null>(null);
  // List vs Matrix is a mode within Tasks, remembered across reloads.
  const [tasksMode, setTasksMode] = useLocalStorage<'list' | 'matrix'>('hitlist-tasks-mode', 'matrix');

  // ── Notifications ─────────────────────────────────────────────────────────
  const { permission: notificationPermission, requestPermission } = useNotifications(todos);
  const {
    activeNotifications,
    freshToastRecords,
    unreadCount,
    dismiss: dismissNotification,
    dismissAll: dismissAllNotifications,
    markToastSeen,
  } = useInAppNotifications(todos);

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeList = useMemo(
    () => lists.find((l) => l.id === activeListId) ?? lists[0],
    [lists, activeListId]
  );

  const listTodos = useMemo(
    () => todos.filter((t) => t.listId === activeListId),
    [todos, activeListId]
  );

  // What the list and matrix show: the active list, narrowed by the filter bar.
  // Filtered here and not on the server on purpose — `todos` also feeds list
  // counts, reminders, note chips and the offline copy, and a filtered fetch
  // would replace all of them with the subset. See lib/taskFilters.
  const visibleTodos = useMemo(
    () => applyTaskFilters(listTodos, filterState),
    [listTodos, filterState]
  );
  const taskCompare = useMemo(() => compareForFilters(filterState), [filterState]);
  // A "Done" filter would otherwise show nothing while completed tasks are hidden.
  const showDoneEffective = showDone || filterState.status === 'DONE';

  const activeTodos = useMemo(() => listTodos.filter((t) => t.status !== 'done'), [listTodos]);
  const doneTodos = useMemo(() => listTodos.filter((t) => t.status === 'done'), [listTodos]);

  const totalCount = listTodos.length;
  const doneCount = doneTodos.length;
  const activeFilterCount = countActiveFilters(filterState);

  // Next step: first in-progress, then first todo
  const nextId = useMemo(() => {
    const inProgress = activeTodos.find((t) => t.status === 'in-progress');
    if (inProgress) return inProgress.id;
    return activeTodos.find((t) => t.status === 'todo')?.id ?? null;
  }, [activeTodos]);

  // Todo counts per list (for sidebar badges)
  const todoCounts = useMemo(() => {
    const counts: Record<string, { active: number; done: number }> = {};
    for (const list of lists) {
      const lt = todos.filter((t) => t.listId === list.id);
      counts[list.id] = {
        active: lt.filter((t) => t.status !== 'done').length,
        done: lt.filter((t) => t.status === 'done').length,
      };
    }
    return counts;
  }, [lists, todos]);

  // Overdue / urgent-soon count for header badge
  const alertCount = useMemo(() => {
    return activeTodos.filter((t) => {
      if (!t.dueDate) return false;
      const nowTs = new Date().getTime();
      const dueTs = t.dueTime
        ? new Date(`${t.dueDate}T${t.dueTime}:00`).getTime()
        : new Date(`${t.dueDate}T23:59:59`).getTime();
      return dueTs < nowTs || (t.dueTime && dueTs - nowTs < 2 * 60 * 60 * 1000);
    }).length;
  }, [activeTodos]);

  // Reminder summary counts (for RemindersSettingsPanel)
  const reminderOverdueCount = useMemo(() => {
    const nowTs = new Date().getTime();
    return activeTodos.filter((t) => {
      if (!t.dueDate) return false;
      const dueTs = t.dueTime
        ? new Date(`${t.dueDate}T${t.dueTime}:00`).getTime()
        : new Date(`${t.dueDate}T23:59:59`).getTime();
      return dueTs < nowTs;
    }).length;
  }, [activeTodos]);

  const reminderDueSoonCount = useMemo(() => {
    const nowTs = new Date().getTime();
    return activeTodos.filter((t) => {
      if (!t.dueDate || !t.dueTime) return false;
      const dueTs = new Date(`${t.dueDate}T${t.dueTime}:00`).getTime();
      const diff = dueTs - nowTs;
      return diff > 0 && diff <= 15 * 60 * 1000;
    }).length;
  }, [activeTodos]);

  const activeReminderCount = useMemo(
    () => activeTodos.filter((t) => t.reminderEnabled && t.dueDate).length,
    [activeTodos]
  );

  // ── Local state helpers ────────────────────────────────────────────────────

  const setTodos = useCallback((updater: (prev: Todo[]) => Todo[]) => {
    setAppState((prev) => ({ ...prev, todos: updater(prev.todos) }));
  }, []);

  const setStats = useCallback((updater: (prev: KaizenStats) => KaizenStats) => {
    setAppState((prev) => ({ ...prev, stats: updater(prev.stats) }));
  }, []);

  const setLastStreakDay = useCallback((day: string) => {
    setAppState((prev) => ({ ...prev, lastStreakDay: day }));
  }, []);

  // ── Mutations (server-first, optimistic local update) ─────────────────────

  const handleAddTask = useCallback(
    async (text: string, quadrant: Quadrant, category?: string, dueDate?: string, dueTime?: string) => {
      const maxOrder = listTodos.reduce((m, t) => Math.max(m, t.order), -1);

      // Optimistic local update — shown immediately while async save runs
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimisticTodo: Todo = {
        id: tempId,
        text,
        status: 'todo',
        createdAt: Date.now(),
        note: undefined,
        category,
        dueDate,
        dueTime,
        listId: activeListId,
        order: maxOrder + 1,
        quadrant,
      };
      setTodos((prev) => [optimisticTodo, ...prev]);
      toast.success('Task added', { description: text, duration: 2000 });

      // Always route through server hook — it uses mockApi when offline
      const quadrantMap: Record<Quadrant, import('@/lib/api').Quadrant> = {
        do: 'DO', schedule: 'SCHEDULE', delegate: 'DELEGATE', eliminate: 'ELIMINATE',
      };
      const created = await server.createTask({
        title: text,
        status: 'TODO',
        quadrant: quadrantMap[quadrant],
        category,
        dueDate,
        dueTime,
        listId: activeListId,
        taskOrder: maxOrder + 1,
      });
      if (created) {
        // Replace temp with persisted task (has real id from mock/server)
        setTodos((prev) => prev.map((t) => t.id === tempId ? apiTaskToTodo(created) : t));
      } else {
        // Mutation failed — remove optimistic entry
        setTodos((prev) => prev.filter((t) => t.id !== tempId));
        toast.error('Failed to save task', { duration: 3000 });
      }
    },
    [activeListId, listTodos, setTodos, server]
  );

  // The completion toast's Undo fires after later renders; a ref keeps it
  // calling the current handler rather than the one from when it was shown.
  const statusChangeRef = useRef<(id: string, status: TodoStatus) => Promise<void>>(async () => {});

  const handleStatusChange = useCallback(
    async (id: string, status: TodoStatus) => {
      // Optimistic update
      const prevTodo = todos.find((t) => t.id === id);
      const undoingCompletion = prevTodo?.status === 'done' && status !== 'done';
      setTodos((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status, completedAt: status === 'done' ? Date.now() : undefined }
            : t
        )
      );

      if (status === 'done') {
        const today = getTodayKey();
        setStats((prev) => {
          const newStreak = appState.lastStreakDay === today ? prev.streak : prev.streak + 1;
          setLastStreakDay(today);
          return {
            streak: newStreak,
            totalCompleted: prev.totalCompleted + 1,
            todayCompleted: prev.todayCompleted + 1,
          };
        });
        toast.success('Task complete! 🌱', {
          description: 'Keep the momentum going.',
          duration: 5000,
          action: { label: 'Undo', onClick: () => { void statusChangeRef.current(id, 'todo'); } },
        });
      } else if (undoingCompletion) {
        // Give back what completing added. The server's momentum, refreshed
        // below, replaces these when online.
        const completedToday = prevTodo?.completedAt
          ? getTodayKeyFor(prevTodo.completedAt) === getTodayKey()
          : false;
        setStats((prev) => ({
          ...prev,
          totalCompleted: Math.max(0, prev.totalCompleted - 1),
          todayCompleted: completedToday ? Math.max(0, prev.todayCompleted - 1) : prev.todayCompleted,
        }));
      }

      // Always route through server hook — uses mockApi when offline
      const statusMap: Record<TodoStatus, import('@/lib/api').TaskStatus> = {
        'todo': 'TODO', 'in-progress': 'IN_PROGRESS', 'done': 'DONE',
      };
      let result;
      if (status === 'done') {
        result = await server.markComplete(id);
      } else {
        result = await server.updateStatus(id, statusMap[status]);
      }
      if (!result && prevTodo) {
        // Rollback on failure
        setTodos((prev) => prev.map((t) => t.id === id ? prevTodo : t));
        toast.error('Failed to update task status', { duration: 3000 });
      } else if (result) {
        // Sync server response (has accurate completedAt)
        setTodos((prev) => prev.map((t) => t.id === id ? apiTaskToTodo(result) : t));
        // Refresh momentum from server/mock
        const m = server.momentum;
        if (m) {
          setStats(() => ({
            streak: m.streak,
            totalCompleted: m.totalCompleted,
            todayCompleted: m.todayCompleted,
          }));
        }
      }
    },
    [todos, setTodos, setStats, appState.lastStreakDay, setLastStreakDay, server]
  );

  useEffect(() => { statusChangeRef.current = handleStatusChange; }, [handleStatusChange]);

  /** Puts a mistakenly completed task back where it was. */
  const handleUndoComplete = useCallback(async (id: string) => {
    const todo = todos.find((t) => t.id === id);
    await handleStatusChange(id, 'todo');
    if (todo) {
      toast.success(`Moved back to ${getQuadrantConfig(todo.quadrant).label}`, { description: todo.text, duration: 2500 });
    }
  }, [todos, handleStatusChange]);

  const handleDelete = useCallback(
    async (id: string) => {
      const prevTodo = todos.find((t) => t.id === id);
      // Optimistic remove (with animation delay)
      setTimeout(() => setTodos((prev) => prev.filter((t) => t.id !== id)), 310);

      // Always route through server hook — uses mockApi when offline
      await server.deleteTask(id);
      if (server.error && prevTodo) {
        setTimeout(() => setTodos((prev) => [...prev, prevTodo]), 400);
        toast.error('Failed to delete task', { duration: 3000 });
      }
    },
    [todos, setTodos, server]
  );

  const handleUpdate = useCallback(
    async (id: string, changes: Partial<Todo>) => {
      const prevTodo = todos.find((t) => t.id === id);
      // Optimistic update
      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
      setDetailTodo((prev) => (prev?.id === id ? { ...prev, ...changes } : prev));
      toast.success('Task updated', { duration: 1500 });

      // Always route through server hook — uses mockApi when offline
      const quadrantMap: Record<Quadrant, import('@/lib/api').Quadrant> = {
        do: 'DO', schedule: 'SCHEDULE', delegate: 'DELEGATE', eliminate: 'ELIMINATE',
      };
      const statusMap: Record<TodoStatus, import('@/lib/api').TaskStatus> = {
        'todo': 'TODO', 'in-progress': 'IN_PROGRESS', 'done': 'DONE',
      };
      const req: import('@/lib/api').TaskUpdateRequest = {};
      if (changes.text !== undefined)     req.title    = changes.text;
      if (changes.note !== undefined)     req.note     = changes.note;
      if (changes.dueDate !== undefined)  req.dueDate  = changes.dueDate;
      if (changes.dueTime !== undefined)  req.dueTime  = changes.dueTime;
      if (changes.category !== undefined) req.category = changes.category;
      if (changes.quadrant !== undefined) req.quadrant = quadrantMap[changes.quadrant];
      if (changes.status !== undefined)   req.status   = statusMap[changes.status];
      if (changes.reminderEnabled !== undefined)       req.reminderEnabled = changes.reminderEnabled;
      if (changes.reminderMinutesBefore !== undefined) req.reminderMinutesBefore = changes.reminderMinutesBefore;

      const result = await server.updateTask(id, req);
      if (!result && prevTodo) {
        // Rollback
        setTodos((prev) => prev.map((t) => t.id === id ? prevTodo : t));
        setDetailTodo((prev) => (prev?.id === id ? prevTodo : prev));
        toast.error('Failed to save changes', { duration: 3000 });
      } else if (result) {
        const updated = apiTaskToTodo(result);
        setTodos((prev) => prev.map((t) => t.id === id ? updated : t));
        setDetailTodo((prev) => (prev?.id === id ? updated : prev));
      }
    },
    [todos, setTodos, server]
  );

  /**
   * Writes back a drag in the list view.
   *
   * Not handleUpdate: that toasts on every call and maps neither `order` nor a
   * batch, so a drop that renumbers five tasks would toast five times. This is
   * one optimistic update, one write per changed task, and a single rollback and
   * error if any write fails. A reorder succeeding is visible; it needs no toast.
   */
  const handleReorder = useCallback(
    async (changes: ReorderChange[]) => {
      const byId = new Map(changes.map((c) => [c.id, c]));
      const before = new Map(todos.filter((t) => byId.has(t.id)).map((t) => [t.id, t]));

      setTodos((prev) => prev.map((t) => {
        const c = byId.get(t.id);
        return c ? { ...t, order: c.order, quadrant: c.quadrant } : t;
      }));

      const quadrantMap: Record<Quadrant, import('@/lib/api').Quadrant> = {
        do: 'DO', schedule: 'SCHEDULE', delegate: 'DELEGATE', eliminate: 'ELIMINATE',
      };
      const results = await Promise.all(
        changes.map((c) => server.updateTask(c.id, { taskOrder: c.order, quadrant: quadrantMap[c.quadrant] })),
      );

      if (results.some((r) => !r)) {
        setTodos((prev) => prev.map((t) => before.get(t.id) ?? t));
        toast.error("Couldn't save the new order", { duration: 3000 });
      }
    },
    [todos, setTodos, server]
  );

  const handleOpenDetail = useCallback((todo: Todo) => {
    setDetailTodo(todo);
    setDetailOpen(true);
  }, []);

  const handleAddToQuadrant = useCallback((quadrant: Quadrant) => {
    setDefaultQuadrant(quadrant);
    setDialogOpen(true);
  }, []);

  const handleToggleReminder = useCallback((id: string, enabled: boolean) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, reminderEnabled: enabled, reminderMinutesBefore: t.reminderMinutesBefore ?? defaultReminderMinutes }
          : t
      )
    );
    setDetailTodo((prev) =>
      prev?.id === id
        ? { ...prev, reminderEnabled: enabled, reminderMinutesBefore: prev.reminderMinutesBefore ?? defaultReminderMinutes }
        : prev
    );
    if (server.serverOnline) {
      server.updateTask(id, {
        reminderEnabled: enabled,
        reminderMinutesBefore: todos.find((t) => t.id === id)?.reminderMinutesBefore ?? defaultReminderMinutes,
      });
    }
  }, [setTodos, defaultReminderMinutes, server, todos]);

  // ── List CRUD ─────────────────────────────────────────────────────────────

  const handleCreateList = useCallback(async (name: string, color: string) => {
    if (server.serverOnline) {
      const created = await server.createList(name, color);
      if (created) {
        const newList = apiListToKaizenList(created);
        setAppState((prev) => ({
          ...prev,
          lists: [...prev.lists, newList],
          activeListId: newList.id,
        }));
        toast.success(`List "${name}" created`, { duration: 2000 });
        return;
      }
    }
    // Offline fallback
    const newList: KaizenList = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      color,
    };
    setAppState((prev) => ({
      ...prev,
      lists: [...prev.lists, newList],
      activeListId: newList.id,
    }));
    toast.success(`List "${name}" created`, { duration: 2000 });
  }, [server]);

  const handleRenameList = useCallback(async (id: string, name: string) => {
    setAppState((prev) => ({
      ...prev,
      lists: prev.lists.map((l) => (l.id === id ? { ...l, name } : l)),
    }));
    if (server.serverOnline) {
      const existing = lists.find((l) => l.id === id);
      await server.updateList(id, name, existing?.color);
    }
  }, [server, lists]);

  const handleDeleteList = useCallback(async (id: string) => {
    setAppState((prev) => {
      if (prev.lists.length <= 1) return prev;
      const newLists = prev.lists.filter((l) => l.id !== id);
      const newActiveId = prev.activeListId === id ? newLists[0].id : prev.activeListId;
      const newTodos = prev.todos.filter((t) => t.listId !== id);
      return { ...prev, lists: newLists, activeListId: newActiveId, todos: newTodos };
    });
    toast('List deleted', { duration: 2000 });
    if (server.serverOnline) {
      await server.deleteList(id);
    }
  }, [server]);

  const handleSelectList = useCallback((id: string) => {
    setAppState((prev) => ({ ...prev, activeListId: id }));
    setDetailOpen(false);
    setFilterState(DEFAULT_FILTERS);
  }, []);

  // ── Notes → quadrants ─────────────────────────────────────────────────────
  // A note block added to a quadrant via "@" becomes a task that remembers the
  // block (SourceNoteId/SourceBlockId). The block keeps the task id and shows
  // the task live. Nothing here ever deletes a task or edits a note.

  const todosRef = useRef(todos);
  useEffect(() => { todosRef.current = todos; }, [todos]);
  const titleSyncTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = titleSyncTimers.current;
    return () => { timers.forEach(clearTimeout); };
  }, []);

  const handleCreateLinkedTask = useCallback<NoteTaskLinking['createTask']>(
    async ({ listId, quadrant, title, noteId, blockId }) => {
      const maxOrder = todosRef.current
        .filter((t) => t.listId === listId)
        .reduce((m, t) => Math.max(m, t.order), -1);
      const quadrantMap: Record<Quadrant, import('@/lib/api').Quadrant> = {
        do: 'DO', schedule: 'SCHEDULE', delegate: 'DELEGATE', eliminate: 'ELIMINATE',
      };
      // The server only stores ids of this shape; anything else is linked from
      // the note side only rather than failing the whole create.
      const safeId = (v: string) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined);

      const created = await server.createTask({
        title,
        status: 'TODO',
        quadrant: quadrantMap[quadrant],
        listId,
        taskOrder: maxOrder + 1,
        sourceNoteId: safeId(noteId),
        sourceBlockId: safeId(blockId),
      });
      if (!created) {
        toast.error("Couldn't add it to the quadrant", { description: 'The note is unchanged.', duration: 3000 });
        return null;
      }
      const todo = apiTaskToTodo(created);
      setTodos((prev) => (prev.some((t) => t.id === todo.id) ? prev : [todo, ...prev]));
      const listName = lists.find((l) => l.id === listId)?.name;
      toast.success(`Added to ${getQuadrantConfig(quadrant).label}${listName ? ` · ${listName}` : ''}`, {
        description: title,
        duration: 2500,
      });
      return todo;
    },
    [lists, server, setTodos],
  );

  /** A linked block was edited: its text becomes the task title, debounced per task. */
  const handleUpdateLinkedTaskTitle = useCallback((taskId: string, title: string) => {
    const timers = titleSyncTimers.current;
    clearTimeout(timers.get(taskId));
    timers.set(taskId, setTimeout(() => {
      timers.delete(taskId);
      const current = todosRef.current.find((t) => t.id === taskId);
      if (!current || current.text === title) return;
      setTodos((prev) => prev.map((t) => (t.id === taskId ? { ...t, text: title } : t)));
      void server.updateTask(taskId, { title });
    }, 800));
  }, [server, setTodos]);

  /** Unlink from the note: clears the task's source, keeps the task. */
  const handleUnlinkTask = useCallback((taskId: string) => {
    const current = todosRef.current.find((t) => t.id === taskId);
    if (!current?.sourceNoteId && !current?.sourceBlockId) return;
    setTodos((prev) => prev.map((t) => (
      t.id === taskId ? { ...t, sourceNoteId: undefined, sourceBlockId: undefined } : t
    )));
    void server.updateTask(taskId, { sourceNoteId: '', sourceBlockId: '' });
  }, [server, setTodos]);

  const handleOpenLinkedTask = useCallback((taskId: string) => {
    const t = todosRef.current.find((x) => x.id === taskId);
    if (!t) { toast.error('That task no longer exists', { duration: 2500 }); return; }
    setActiveView('tasks');
    if (t.listId && t.listId !== activeListId) handleSelectList(t.listId);
    handleOpenDetail(t);
  }, [activeListId, handleSelectList, handleOpenDetail]);

  const handleOpenSourceNote = useCallback((noteId: string) => {
    setDetailOpen(false);
    setPendingNoteId(noteId);
    setActiveView('notes');
  }, []);

  const noteLinking = useMemo<NoteTaskLinking>(() => ({
    lists,
    todos,
    tasksLoaded: !server.loading,
    preferredListId: activeListId,
    createTask: handleCreateLinkedTask,
    updateTaskTitle: handleUpdateLinkedTaskTitle,
    unlinkTask: handleUnlinkTask,
    openTask: handleOpenLinkedTask,
  }), [lists, todos, server.loading, activeListId, handleCreateLinkedTask, handleUpdateLinkedTaskTitle, handleUnlinkTask, handleOpenLinkedTask]);

  const handleOpenNoteHandled = useCallback(() => setPendingNoteId(null), []);

  /** "Add escalation" on a task: hand it to Automations with the form open. */
  const handleAddEscalation = useCallback((taskId: string) => {
    setDetailOpen(false);
    setPendingEscalationTaskId(taskId);
    setActiveView('automations');
  }, []);

  const handleEscalationHandled = useCallback(() => setPendingEscalationTaskId(null), []);

  // ── Clear done (server-aware) ─────────────────────────────────────────────

  const handleClearDone = useCallback(async () => {
    const doneIds = listTodos.filter((t) => t.status === 'done').map((t) => t.id);
    setTodos((prev) => prev.filter((t) => !(t.listId === activeListId && t.status === 'done')));
    toast('Cleared completed tasks', { duration: 2000 });
    if (server.serverOnline) {
      await Promise.all(doneIds.map((id) => server.deleteTask(id)));
    }
  }, [listTodos, activeListId, setTodos, server]);

  // ── Layout ────────────────────────────────────────────────────────────────

  const remindersNeedAttention = isNotificationSupported() && notificationPermission !== 'granted';

  const tasksTopBar = (
    <TopBar
      dotClass={activeList ? getListColorDot(activeList.color) : undefined}
      title={activeList?.name ?? 'Tasks'}
      subtitle={
        <>
          {totalCount} task{totalCount !== 1 ? 's' : ''} · {stats.todayCompleted} done today
          {alertCount > 0 && (
            <span className="ml-2 font-semibold text-q-do">
              {alertCount} need{alertCount === 1 ? 's' : ''} attention
            </span>
          )}
        </>
      }
      actions={
        <>
          <TopBarToggle
            label="Task view"
            value={tasksMode}
            onChange={setTasksMode}
            options={[{ value: 'list', label: 'List' }, { value: 'matrix', label: 'Matrix' }]}
          />

          {/* One quiet pill for everything that narrows or tidies the view. It
              was a filter bar in the scroll column, which scrolled away. */}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={topBarPill} aria-label={`Filter${activeFilterCount ? ` (${activeFilterCount} active)` : ''}`}>
                <SlidersHorizontal className="size-3.5" strokeWidth={2.75} aria-hidden />
                <span className="hidden sm:inline">Filter</span>
                {activeFilterCount > 0 && (
                  <span className="flex min-w-[18px] items-center justify-center rounded-full bg-a-accent px-1 text-[11px] font-bold leading-[18px] text-a-bg">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(92vw,560px)] p-3">
              <AdvancedFilterBar filters={filterState} onChange={setFilterState} />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-a-line-soft pt-3">
                <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-a-ink">
                  <Switch checked={showDone} onCheckedChange={setShowDone} />
                  Show completed
                </label>
                {doneCount > 0 && showDone && (
                  <button
                    type="button"
                    onClick={handleClearDone}
                    className="text-[13px] text-a-faint transition-colors duration-150 hover:text-a-ink"
                  >
                    Clear done ({doneCount})
                  </button>
                )}
              </div>
              {activeFilterCount > 0 && tasksMode === 'list' && (
                <p className="mt-2 text-[12px] text-a-faint">Drag to reorder is off while filters are active.</p>
              )}
            </PopoverContent>
          </Popover>

          <button
            type="button"
            onClick={() => { setDefaultQuadrant('do'); setDialogOpen(true); }}
            className={topBarPrimary}
            aria-label="Add new task"
          >
            <Plus className="size-[15px]" strokeWidth={2.75} aria-hidden />
            <span className="hidden sm:inline">Add task</span>
          </button>
        </>
      }
    />
  );

  return (
    <>
      <Toaster position="top-center" richColors />

      <AppShell
        rail={
          <IconRail
            activeView={activeView}
            onViewChange={setActiveView}
            bell={
              <NotificationBell
                notifications={activeNotifications}
                unreadCount={unreadCount}
                onDismiss={dismissNotification}
                onDismissAll={dismissAllNotifications}
                onNavigateToTask={(taskId) => {
                  const t = todos.find((x) => x.id === taskId);
                  if (t) { setActiveView('tasks'); handleOpenDetail(t); }
                }}
                className="size-10 rounded-[14px] text-a-rail-fg/60 hover:bg-a-rail-fg/10 hover:text-a-rail-fg"
              />
            }
            account={
              <UserMenu
                onOpenReminders={() => setShowReminders(true)}
                remindersNeedAttention={remindersNeedAttention}
              />
            }
          />
        }
      >
        {activeView === 'notes' ? (
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <NotesWorkspace
              linking={noteLinking}
              openNoteId={pendingNoteId}
              onOpenNoteHandled={handleOpenNoteHandled}
            />
          </div>
        ) : activeView === 'automations' ? (
          <div className="flex min-h-0 min-w-0 flex-1">
            <AutomationsPage
              todos={todos}
              escalationTaskId={pendingEscalationTaskId}
              onEscalationHandled={handleEscalationHandled}
            />
          </div>
        ) : (
          <ViewLayout
            contextLabel="Lists"
            context={
              <ListSidebar
                lists={lists}
                activeListId={activeListId}
                todoCounts={todoCounts}
                onSelectList={handleSelectList}
                onCreateList={handleCreateList}
                onRenameList={handleRenameList}
                onDeleteList={handleDeleteList}
                loading={server.loading}
              />
            }
            contextFoot={
              <>
                {!server.loading && !server.serverOnline && (
                  <p className="flex items-center gap-1.5 px-3 pt-2 text-[12.5px] text-q-delegate" role="status">
                    <WifiOff className="size-3.5" strokeWidth={2.75} aria-hidden />
                    Offline — using local data
                  </p>
                )}
                {/* Momentum moved here from a card at the top of the page. */}
                <MomentumBar
                  stats={stats}
                  total={totalCount}
                  done={doneCount}
                  onViewHistory={() => setShowTodayHistory(true)}
                  onViewProgress={() => setShowStreak(true)}
                />
              </>
            }
            topBar={tasksTopBar}
          >
            {/* Sync status: shows only while saving, offline, or erroring — with Retry. */}
            <SyncStatusBar
              loading={server.loading}
              saving={server.saving}
              error={server.error}
              serverOnline={server.serverOnline}
              backendUnavailable={server.backendUnavailable}
              onRetry={server.refresh}
              onDismissError={server.clearError}
            />

            <div className="px-4 py-[22px] md:px-[26px]">
              {server.loading ? (
                <LoadingSkeleton />
              ) : listTodos.length === 0 ? (
                <EmptyState onAdd={() => { setDefaultQuadrant('do'); setDialogOpen(true); }} />
              ) : visibleTodos.length === 0 ? (
                <NoMatchingTasks onClear={() => setFilterState(DEFAULT_FILTERS)} />
              ) : tasksMode === 'list' ? (
                <TaskListView
                  todos={visibleTodos}
                  compare={taskCompare}
                  showDone={showDoneEffective}
                  nextId={nextId}
                  dragDisabled={activeFilterCount > 0}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onOpen={handleOpenDetail}
                  onAddToQuadrant={handleAddToQuadrant}
                  onReorder={handleReorder}
                  onToggleReminder={handleToggleReminder}
                  onOpenNote={handleOpenSourceNote}
                  notificationPermission={notificationPermission}
                />
              ) : (
                <EisenhowerMatrix
                  todos={visibleTodos}
                  compare={taskCompare}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onOpen={handleOpenDetail}
                  onAddToQuadrant={handleAddToQuadrant}
                  nextId={nextId}
                  showDone={showDoneEffective}
                  onToggleReminder={handleToggleReminder}
                  onOpenNote={handleOpenSourceNote}
                  notificationPermission={notificationPermission}
                />
              )}
            </div>
          </ViewLayout>
        )}
      </AppShell>

      {/* In-app notification toasts */}
      <NotificationToast
        freshRecords={freshToastRecords}
        onDismiss={dismissNotification}
        onMarkSeen={markToastSeen}
      />

      {/* Add task dialog */}
      <AddTaskDialog
        open={dialogOpen}
        defaultQuadrant={defaultQuadrant}
        onOpenChange={setDialogOpen}
        onAdd={handleAddTask}
      />

      {/* Today's history panel — server-backed when online */}
      <TodayHistoryPanel
        open={showTodayHistory}
        todos={todos}
        serverHistory={server.serverOnline ? server.todayHistory : undefined}
        onClose={() => setShowTodayHistory(false)}
        onUndo={handleUndoComplete}
      />

      {/* Reminder settings — reached from the account menu in the rail. */}
      <Dialog open={showReminders} onOpenChange={setShowReminders}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-[22px] font-normal">Reminders</DialogTitle>
          </DialogHeader>
          <RemindersSettingsPanel
            permission={notificationPermission}
            defaultMinutes={defaultReminderMinutes}
            onRequestPermission={requestPermission}
            onDefaultMinutesChange={setDefaultReminderMinutes}
            activeReminderCount={activeReminderCount}
            overdueCount={reminderOverdueCount}
            dueSoonCount={reminderDueSoonCount}
          />
        </DialogContent>
      </Dialog>

      {/* Weekly progress — reached from the momentum foot. */}
      <Dialog open={showStreak} onOpenChange={setShowStreak}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-[22px] font-normal">Progress</DialogTitle>
          </DialogHeader>
          <StreakPanel todos={listTodos} listName={activeList?.name ?? 'this list'} />
        </DialogContent>
      </Dialog>

      {/* Task detail panel */}
      <TaskDetailPanel
        todo={detailTodo}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onOpenNote={handleOpenSourceNote}
        onAddEscalation={handleAddEscalation}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onStatusChange={handleStatusChange}
        notificationPermission={notificationPermission}
        defaultReminderMinutes={defaultReminderMinutes}
      />
    </>
  );
}

// Retained for the error states it renders; unused by the current layout,
// which routes errors through SyncStatusBar.
void ErrorBanner;

export default App;
