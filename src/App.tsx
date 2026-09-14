import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Plus,
  Leaf,
  Menu,
  BarChart2,
  LayoutGrid,
  Eye,
  EyeOff,
  Grid2x2,
  WifiOff,
  RefreshCw,
  AlertCircle,
  X,
  Bell,
  StickyNote,
  LogOut,
  User,
  MailCheck,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { NotesWorkspace } from '@/components/NotesWorkspace';
import { useNotes } from '@/hooks/useNotes';
import { AutomationsPage } from '@/pages/AutomationsPage';
import { useAutomations } from '@/hooks/useAutomations';
import { useNotifications } from '@/hooks/useNotifications';
import { useInAppNotifications } from '@/hooks/useInAppNotifications';
import { NotificationBell } from '@/components/NotificationBell';
import { NotificationToast } from '@/components/NotificationToast';
import { RemindersSettingsPanel } from '@/components/RemindersSettingsPanel';
import type { ReminderMinutes } from '@/lib/notifications';
import { DEFAULT_REMINDER_MINUTES, isNotificationSupported } from '@/lib/notifications';
import { Toaster, toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MomentumBar } from '@/components/MomentumBar';
import { TodayHistoryPanel } from '@/components/TodayHistoryPanel';
import { ListSidebar } from '@/components/ListSidebar';
import { StreakPanel } from '@/components/StreakPanel';
import { EisenhowerMatrix } from '@/components/EisenhowerMatrix';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import { loadAppState, saveAppState, setActiveUserId } from '@/lib/storage';
import { useCatalystSync, apiTaskToTodo, apiListToKaizenList } from '@/hooks/useCatalystSync';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import { AdvancedFilterBar, DEFAULT_FILTERS, filtersToParams } from '@/components/AdvancedFilterBar';
import type { FilterState } from '@/components/AdvancedFilterBar';
import { EmptyState } from '@/components/EmptyState';
import { useCatalystUser } from '@/components/CatalystAuthGate';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type {
  Todo,
  TodoStatus,
  KaizenStats,
  KaizenList,
  AppState,
  Quadrant,
} from '@/types/todo';
import { QUADRANTS } from '@/types/todo';

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
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Grid2x2 className="size-4 text-primary" />
            Add task to matrix
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Task text */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Task
            </Label>
            <Input
              ref={inputRef}
              value={text}
              onChange={(e) => { setText(e.target.value); setError(''); }}
              placeholder="What needs to be done?"
              className={cn('rounded-xl text-sm', error && 'border-destructive')}
              maxLength={200}
            />
            {error && <p className="text-xs text-destructive animate-fade-in">{error}</p>}
          </div>

          {/* Quadrant */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Priority Quadrant
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {QUADRANTS.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setQuadrant(q.id)}
                  className={cn(
                    'flex flex-col items-start rounded-xl px-3 py-2.5 text-left border transition-all duration-150',
                    quadrant === q.id
                      ? 'border-primary/40 bg-primary/8 ring-1 ring-primary/20'
                      : 'border-border bg-card hover:border-border/80'
                  )}
                >
                  <span className="text-xs font-semibold text-foreground">{q.label}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">{q.subtitle}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Category + Due date row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Category
              </Label>
              <Select value={category || '__none__'} onValueChange={(v) => setCategory(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-9 text-xs rounded-xl w-full">
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
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Due date
              </Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9 text-xs rounded-xl"
              />
            </div>
          </div>

          {/* Due time (only if date set) */}
          {dueDate && (
            <div className="space-y-1.5 animate-fade-in">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Due time <span className="normal-case font-normal">(optional)</span>
              </Label>
              <Input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="h-9 text-xs rounded-xl w-36"
              />
            </div>
          )}

          <DialogFooter className="pt-1 gap-2">
            <Button type="button" variant="ghost" className="rounded-xl" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl flex-1">
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
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="px-4 md:px-6 py-5 space-y-5 max-w-6xl mx-auto animate-fade-in">
      {/* Momentum bar skeleton */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex gap-4 pt-1 border-t border-border/60">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>

      {/* Matrix skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="p-3 space-y-2">
              {[0, 1].map((j) => (
                <div key={j} className="rounded-xl border border-border bg-background p-3 space-y-2">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
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

// ── User Menu ──────────────────────────────────────────────────────────────

function UserMenu() {
  const { session, signOut } = useCatalystUser();

  if (!session) return null;

  const initials = session.username?.[0]?.toUpperCase() || session.email?.[0]?.toUpperCase() || 'U';
  const displayName = session.username || session.email;
  const isVerified = session.emailVerified;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-muted/60 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="User menu"
        >
          <div className="relative">
            <Avatar size="sm">
              <AvatarFallback className="text-[10px] font-semibold bg-primary/15 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            {/* Verified badge */}
            {isVerified && (
              <div
                className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary ring-1 ring-background"
                aria-label="Verified"
              >
                <ShieldCheck className="size-2 text-primary-foreground" />
              </div>
            )}
          </div>
          <span className="hidden sm:block text-xs font-medium text-foreground max-w-[120px] truncate">
            {displayName}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* Account info */}
        <div className="px-3 py-3 space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-foreground truncate flex-1">{displayName}</p>
            {isVerified ? (
              <span className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 rounded-full px-1.5 py-0.5 flex-shrink-0">
                <ShieldCheck className="size-2.5" />
                Verified
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-medium text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 rounded-full px-1.5 py-0.5 flex-shrink-0">
                <ShieldAlert className="size-2.5" />
                Unverified
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{session.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={signOut}
          className="gap-2.5 cursor-pointer"
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const server = useCatalystSync(appState.activeListId, filtersToParams(filterState));

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showStreak, setShowStreak] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showTodayHistory, setShowTodayHistory] = useState(false);
  const [defaultReminderMinutes, setDefaultReminderMinutes] = useState<ReminderMinutes>(DEFAULT_REMINDER_MINUTES);
  const [activeView, setActiveView] = useState<'tasks' | 'notes' | 'automations'>('tasks');

  // Notes state (count for sidebar badge)
  const { notes } = useNotes();

  // Automations state (count for sidebar badge)
  const { rules: automationRules } = useAutomations(todos.map((t) => ({ id: t.id, text: t.text })));
  const automationsActiveCount = automationRules.filter((r) => r.status === 'active').length;

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

  const activeTodos = useMemo(() => listTodos.filter((t) => t.status !== 'done'), [listTodos]);
  const doneTodos = useMemo(() => listTodos.filter((t) => t.status === 'done'), [listTodos]);

  const totalCount = listTodos.length;
  const doneCount = doneTodos.length;

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

  const handleStatusChange = useCallback(
    async (id: string, status: TodoStatus) => {
      // Optimistic update
      const prevTodo = todos.find((t) => t.id === id);
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
        toast.success('Task complete! 🌱', { description: 'Keep the momentum going.', duration: 2500 });
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

  return (
    <div className="min-h-svh bg-background flex">
      <Toaster position="top-center" richColors />

      {/* ── Desktop sidebar ── */}
      <div className="hidden md:flex flex-col h-screen sticky top-0 w-64 flex-shrink-0">
        <ListSidebar
          lists={lists}
          activeListId={activeListId}
          todoCounts={todoCounts}
          onSelectList={handleSelectList}
          onCreateList={handleCreateList}
          onRenameList={handleRenameList}
          onDeleteList={handleDeleteList}
          activeView={activeView}
          onViewChange={(v) => setActiveView(v)}
          notesCount={notes.length}
          automationsCount={automationsActiveCount}
        />
      </div>

      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-72 z-50 shadow-xl animate-slide-up">
            <ListSidebar
              lists={lists}
              activeListId={activeListId}
              todoCounts={todoCounts}
              onSelectList={(id) => { handleSelectList(id); setSidebarOpen(false); }}
              onCreateList={handleCreateList}
              onRenameList={handleRenameList}
              onDeleteList={handleDeleteList}
              onClose={() => setSidebarOpen(false)}
              isMobile
              activeView={activeView}
              onViewChange={(v) => { setActiveView(v); setSidebarOpen(false); }}
              notesCount={notes.length}
              automationsCount={automationsActiveCount}
            />
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Email verification banner */}

        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 px-4 md:px-6 h-14">
            {/* Mobile menu */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(true)}
              className="md:hidden text-muted-foreground hover:text-foreground -ml-1"
              aria-label="Open lists"
            >
              <Menu className="size-5" />
            </Button>

            {/* Logo + title */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                <Leaf className="size-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-bold tracking-tight text-foreground truncate leading-tight">
                  {activeView === 'notes' ? 'Rough Notes' : activeView === 'automations' ? 'Automations' : (activeList?.name ?? 'Kaizen Flow')}
                </h1>
                <p className="text-[10px] text-muted-foreground leading-tight hidden sm:block">
                  {activeView === 'notes'
                    ? `${notes.length} note${notes.length !== 1 ? 's' : ''} · Notion-style workspace`
                    : activeView === 'automations'
                    ? `${automationsActiveCount} active rule${automationsActiveCount !== 1 ? 's' : ''} · Scheduled reminders`
                    : <>
                        Eisenhower Matrix · {activeTodos.length} active
                        {alertCount > 0 && (
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold text-destructive">
                            {alertCount} alert{alertCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </>
                  }
                </p>
              </div>
            </div>

            {/* Header actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* View toggle (mobile) */}
              <div className="flex md:hidden rounded-lg bg-muted/40 p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setActiveView('tasks')}
                  className={cn(
                    'flex items-center justify-center h-7 w-7 rounded-md text-xs transition-all duration-150',
                    activeView === 'tasks' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                  )}
                  aria-label="Tasks view"
                >
                  <LayoutGrid className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('notes')}
                  className={cn(
                    'flex items-center justify-center h-7 w-7 rounded-md text-xs transition-all duration-150',
                    activeView === 'notes' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                  )}
                  aria-label="Notes view"
                >
                  <StickyNote className="size-3.5" />
                </button>
              </div>

              {activeView === 'tasks' && (
                <>
                  {/* Offline indicator */}
                  {!server.loading && !server.serverOnline && (
                    <div
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 bg-amber-500/10 border border-amber-500/20 animate-fade-in"
                      title="Server offline — using local data"
                    >
                      <WifiOff className="size-3 text-amber-500" />
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hidden sm:inline">Offline</span>
                    </div>
                  )}

                  {/* Show/hide done */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDone((v) => !v)}
                    className={cn(
                      'h-8 px-2.5 text-xs gap-1.5 rounded-lg transition-colors duration-150',
                      showDone ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-label={showDone ? 'Hide completed tasks' : 'Show completed tasks'}
                  >
                    {showDone ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    <span className="hidden sm:inline">{showDone ? 'Hide done' : 'Show done'}</span>
                  </Button>

                  {/* Streak toggle */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowStreak((v) => !v)}
                    aria-label="Toggle progress panel"
                    className={cn(
                      'size-8 rounded-lg transition-colors duration-150',
                      showStreak ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <BarChart2 className="size-4" />
                  </Button>

                  {/* Notification bell */}
                  <NotificationBell
                    notifications={activeNotifications}
                    unreadCount={unreadCount}
                    onDismiss={dismissNotification}
                    onDismissAll={dismissAllNotifications}
                    onNavigateToTask={(taskId) => {
                      const t = todos.find((x) => x.id === taskId);
                      if (t) handleOpenDetail(t);
                    }}
                  />

                  {/* Reminders settings toggle */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowReminders((v) => !v)}
                    aria-label="Toggle reminders panel"
                    className={cn(
                      'size-8 rounded-lg transition-colors duration-150 relative',
                      showReminders ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Bell className="size-4" />
                    {notificationPermission !== 'granted' && isNotificationSupported() && (
                      <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500" />
                    )}
                  </Button>

                  {/* Add task */}
                  <Button
                    onClick={() => { setDefaultQuadrant('do'); setDialogOpen(true); }}
                    size="sm"
                    className="h-8 px-3 text-xs rounded-lg gap-1.5"
                    aria-label="Add new task"
                  >
                    <Plus className="size-3.5" />
                    <span className="hidden sm:inline">Add task</span>
                  </Button>
                </>
              )}

              {/* User avatar / sign-out */}
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Sync status bar — only in tasks view */}
        {activeView === 'tasks' && (
          <SyncStatusBar
            loading={server.loading}
            saving={server.saving}
            error={server.error}
            serverOnline={server.serverOnline}
            backendUnavailable={server.backendUnavailable}
            onRetry={server.refresh}
            onDismissError={server.clearError}
          />
        )}

        {/* Content area */}
        {activeView === 'notes' ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <NotesWorkspace />
          </div>
        ) : activeView === 'automations' ? (
          <div className="flex-1 overflow-auto">
            <AutomationsPage todos={todos} />
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {server.loading ? (
              <LoadingSkeleton />
            ) : (
              <div className="px-4 md:px-6 py-5 space-y-5 max-w-6xl mx-auto">

                {/* Momentum bar */}
                <MomentumBar
                  stats={stats}
                  total={totalCount}
                  done={doneCount}
                  onViewHistory={() => setShowTodayHistory(true)}
                />

                {/* Streak / Progress panel */}
                {showStreak && (
                  <div className="animate-fade-in">
                    <StreakPanel todos={listTodos} listName={activeList?.name ?? 'this list'} />
                  </div>
                )}

                {/* Matrix legend */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <LayoutGrid className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground">Eisenhower Matrix</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {QUADRANTS.map((q) => (
                      <span
                        key={q.id}
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                          q.badgeClass
                        )}
                      >
                        {q.label}
                      </span>
                    ))}
                  </div>
                  <div className="flex-1" />
                  {doneCount > 0 && showDone && (
                    <button
                      onClick={handleClearDone}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-150"
                    >
                      Clear done ({doneCount})
                    </button>
                  )}
                </div>

                {/* Reminders panel */}
                {showReminders && (
                  <div className="animate-fade-in">
                    <RemindersSettingsPanel
                      permission={notificationPermission}
                      defaultMinutes={defaultReminderMinutes}
                      onRequestPermission={requestPermission}
                      onDefaultMinutesChange={setDefaultReminderMinutes}
                      activeReminderCount={activeReminderCount}
                      overdueCount={reminderOverdueCount}
                      dueSoonCount={reminderDueSoonCount}
                    />
                  </div>
                )}

                {/* Advanced filter bar */}
                <AdvancedFilterBar
                  filters={filterState}
                  onChange={setFilterState}
                  className="animate-fade-in"
                />

                {/* Eisenhower Matrix — or empty state when list has no tasks */}
                {listTodos.length === 0 ? (
                  <EmptyState onAdd={() => { setDefaultQuadrant('do'); setDialogOpen(true); }} />
                ) : (
                  <EisenhowerMatrix
                    todos={listTodos}
                    onStatusChange={handleStatusChange}
                    onDelete={handleDelete}
                    onOpen={handleOpenDetail}
                    onAddToQuadrant={handleAddToQuadrant}
                    nextId={nextId}
                    showDone={showDone}
                    onToggleReminder={handleToggleReminder}
                    notificationPermission={notificationPermission}
                  />
                )}

                {/* Footer hint */}
                {activeTodos.length > 0 && (
                  <p className="text-center text-[10px] text-muted-foreground/50 pb-4 animate-fade-in">
                    Click any task to open details · Tap ○ to advance status · + to add to a quadrant
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>

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
      />

      {/* Task detail panel */}
      <TaskDetailPanel
        todo={detailTodo}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onStatusChange={handleStatusChange}
        notificationPermission={notificationPermission}
        defaultReminderMinutes={defaultReminderMinutes}
      />
    </div>
  );
}

export default App;
