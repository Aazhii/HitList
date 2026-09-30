import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
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
import { DatabasesPage, type DatabaseTaskLinking } from '@/pages/DatabasesPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useHistoryState, readInitialScreen } from '@/hooks/useHistoryState';
import { Toaster, toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MomentumBar } from '@/components/MomentumBar';
import { TodayHistoryPanel } from '@/components/TodayHistoryPanel';
import { ListSidebar } from '@/components/ListSidebar';
import { StreakPanel, weekRangeLabel } from '@/components/StreakPanel';
import { EisenhowerMatrix } from '@/components/EisenhowerMatrix';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskTableView } from '@/components/tasks/TaskTableView';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { ViewTabs, type NewViewInput } from '@/components/tasks/ViewTabs';
import { ColumnsMenu } from '@/components/tasks/ColumnsMenu';
import { sortByColumnOrder } from '@/components/tasks/TaskTableView';
import { TaskDetailPanel } from '@/components/TaskDetailPanel';
import { AppShell } from '@/components/shell/AppShell';
import { Sidebar, type AppView } from '@/components/shell/Sidebar';
import { AppHeader } from '@/components/shell/AppHeader';
import { ViewLayoutContext } from '@/components/shell/ViewLayout';
import { BTN_MD, TopBar, TopBarToggle, topBarPill, topBarPrimary, topBarSecondary } from '@/components/shell/TopBar';
import { UserMenu } from '@/components/shell/UserMenu';
import { NotificationBell } from '@/components/NotificationBell';
import { NotificationToast } from '@/components/NotificationToast';
import { useInAppNotifications } from '@/hooks/useInAppNotifications';
import { loadAppState, saveAppState, setActiveUserId, getActiveUserId } from '@/lib/storage';
import {
  applyTaskFilters, compareAcrossQuadrants, compareForFilters, countNarrowingFilters, describeActiveFilters, FIELD_EMPTY,
  groupFieldFor, isGroupableField, normaliseFilters, sameFilters,
} from '@/lib/taskFilters';
import type { TaskLayout, ViewDisplay } from '@/lib/api';
import { useSavedViews } from '@/hooks/useSavedViews';
import type { ApiSavedView } from '@/lib/api';
import { SavedViewsSection } from '@/components/tasks/SavedViewsSection';
import { SaveViewForm } from '@/components/tasks/SaveViewForm';
import { useTaskFields } from '@/hooks/useTaskFields';
import { FieldsManagerDialog, anchorRectOf, type AnchorRect } from '@/components/fields/FieldsManager';
import type { FieldValue } from '@/types/fields';
import type { ReorderChange } from '@/lib/reorder';
import { useAppSync, apiTaskToTodo, apiListToKaizenList } from '@/hooks/useAppSync';
import { SyncStatusBar } from '@/components/SyncStatusBar';
import {
  AdvancedFilterBar,
  DEFAULT_FILTERS,
  countActiveFilters,
} from '@/components/AdvancedFilterBar';
import type { FilterState } from '@/components/AdvancedFilterBar';
import { EmptyState, ILL } from '@/components/EmptyState';
import { FilterPanel } from '@/components/tasks/FilterPanel';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { QuadrantPicker } from '@/components/tasks/QuadrantPicker';
import { CATEGORIES } from '@/types/todo';
import { cn } from '@/lib/utils';

interface AddTaskDialogProps {
  open: boolean;
  defaultQuadrant: Quadrant;
  /** A due date to start with — set when adding from a calendar day. */
  defaultDueDate?: string;
  onOpenChange: (v: boolean) => void;
  onAdd: (text: string, quadrant: Quadrant, category?: string, dueDate?: string, dueTime?: string) => void;
}

// DS field label (--font-label): 13px / 500, ink, sentence case.
const FIELD_LABEL = 'text-[13px] font-medium leading-[1.35] text-a-ink';

function AddTaskDialog({ open, defaultQuadrant, defaultDueDate, onOpenChange, onAdd }: AddTaskDialogProps) {
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
    setDueDate(defaultDueDate ?? '');
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, defaultQuadrant, defaultDueDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setError('Task description is required.'); return; }
    onAdd(text.trim(), quadrant, category || undefined, dueDate || undefined, dueTime || undefined);
    setText(''); setCategory(''); setDueDate(''); setDueTime(''); setError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
          <DialogDescription>Pick the quadrant that fits — you can change it any time.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Task text */}
          <div className="flex flex-col gap-2">
            <Label className={cn(FIELD_LABEL, "gap-1")} htmlFor="add-task-text">Task<span className="text-a-red-line">*</span></Label>
            <Input
              id="add-task-text"
              ref={inputRef}
              value={text}
              onChange={(e) => { setText(e.target.value); setError(''); }}
              placeholder="What needs to be done?"
              aria-invalid={error ? true : undefined}
              maxLength={200}
            />
            {error && <p className="text-[11px] text-q-do animate-fade-in">{error}</p>}
          </div>

          {/* Quadrant — showcase 944–948 */}
          <div>
            <div className="mb-1.5 font-medium">Priority quadrant</div>
            <QuadrantPicker value={quadrant} onChange={setQuadrant} />
          </div>

          {/* Category + Due date row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label className={FIELD_LABEL}>Category</Label>
              <Select value={category || '__none__'} onValueChange={(v) => setCategory(v === '__none__' ? '' : v)}>
                <SelectTrigger className="w-full" aria-label="Category">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-a-faint">None</span>
                  </SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className={FIELD_LABEL} htmlFor="add-task-date">Due date</Label>
              <Input id="add-task-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="flex w-1/2 flex-col gap-2">
            <Label className={FIELD_LABEL} htmlFor="add-task-time">Due time (optional)</Label>
            <Input id="add-task-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>

          <DialogFooter>
            <button type="button" className={cn(topBarPill, BTN_MD)} onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="submit" className={cn(topBarPrimary, BTN_MD)}>
              Add task
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * The control that was just clicked, for a popover opened from a menu item —
 * when the handler runs, focus is still on it.
 */
function activeAnchor(): AnchorRect | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? anchorRectOf(el) : null;
}

/** A table with no column choices: everything shown, in field order. */
const EMPTY_DISPLAY: ViewDisplay = { hidden: [], order: [], widths: {} };

/** Whether two sets of column choices would show the same table. */
function sameDisplay(a: ViewDisplay, b: ViewDisplay): boolean {
  const key = (d: ViewDisplay) => JSON.stringify([[...d.hidden].sort(), d.order, d.widths]);
  return key(a) === key(b);
}

/** One column moved left or right, as the full order. */
function moveColumn(ids: string[], columnId: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(columnId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

function getTodayKey() {
  return getTodayKeyFor(Date.now());
}

function getTodayKeyFor(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── No tasks match the filters ─────────────────────────────────────────────

function NoMatchingTasks({ hidden, clauses, onClear }: { hidden: number; clauses: string[]; onClear: () => void }) {
  // Showcase 179–181: say what is hiding the tasks and that they are safe.
  const because = clauses.length > 0 ? ` by ${clauses.join(' and ')}` : '';
  return (
    <EmptyState
      image={ILL.noFilteredData}
      title="No tasks match these filters"
      description={`Your tasks are safe — ${hidden} ${hidden === 1 ? 'is' : 'are'} hidden${because}. Loosen a filter or clear them all.`}
      action={
        <button type="button" onClick={onClear} className={cn(topBarPrimary, BTN_MD)}>
          Clear filters
        </button>
      }
    />
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────

/** The shape of whatever is loading, so the wait looks like the screen that follows. */
function LoadingSkeleton({ layout }: { layout: TaskLayout }) {
  if (layout === 'board') {
    return (
      <div className="flex gap-4 animate-fade-in" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-[292px] flex-shrink-0 space-y-2 rounded-[12px] bg-a-surface p-2.5">
            <Skeleton className="h-4 w-24 bg-a-bg" />
            {[0, 1].map((j) => <Skeleton key={j} className="h-16 w-full rounded-[8px] bg-a-bg" />)}
          </div>
        ))}
      </div>
    );
  }

  if (layout === 'calendar') {
    return (
      <div className="space-y-3 animate-fade-in" aria-hidden>
        <Skeleton className="h-6 w-40 bg-a-surface" />
        <div className="grid grid-cols-7 gap-px">
          {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="h-[92px] w-full rounded-none bg-a-surface" />)}
        </div>
      </div>
    );
  }

  if (layout === 'table') {
    return (
      <div className="space-y-2 animate-fade-in" aria-hidden>
        <Skeleton className="h-6 w-full bg-a-surface" />
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full rounded-[8px] bg-a-surface" />)}
      </div>
    );
  }

  if (layout === 'list') {
    return (
      <div className="mx-auto w-full max-w-[880px] space-y-6 animate-fade-in" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-32 bg-a-surface" />
            {[0, 1, 2].map((j) => <Skeleton key={j} className="h-11 w-full rounded-[8px] bg-a-surface" />)}
          </div>
        ))}
      </div>
    );
  }

  // Showcase 162–171: four white bordered cards in a 2-up grid, each a heading bar
  // over three row bars.
  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 md:grid-cols-2 animate-fade-in" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-[8px] border border-a-line bg-a-surface p-4">
          <div className="h-3.5 w-[120px] animate-pulse rounded-[4px] bg-a-line-soft" />
          {[0, 1, 2].map((j) => <div key={j} className="h-9 animate-pulse rounded-[6px] bg-a-bg" />)}
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
  setActiveUserId(null);
  return <UserScopedApp key="local" />;
}

function UserScopedApp() {
  // ── Organic theme ────────────────────────────────────────────────────────
  // On <html>, not on App's root element: sheets, dialogs, menus, popovers and
  // the toaster portal into document.body, outside this tree, and would render
  // unthemed. The login page never mounts App, so it keeps its own theme.
  useEffect(() => {
    document.documentElement.classList.add('app-organic');
    return () => document.documentElement.classList.remove('app-organic');
  }, []);

  // ── localStorage state scoped to the active workspace ────────────────────
  const [appState, setAppState] = useState<AppState>(() => {
    return loadAppState();
  });

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterState, setFilterState] = useState<FilterState>(DEFAULT_FILTERS);

  // ── Server sync ───────────────────────────────────────────────────────────
  const server = useAppSync(appState.activeListId);

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

      // The reachable server is authoritative, even for a new empty browser
      // workspace. Keeping local seed lists here would let the UI submit a
      // non-existent list id and receive a server-side 404 on its first task.
      const mergedLists = server.serverOnline ? serverLists : (serverLists.length > 0 ? serverLists : prev.lists);

      const validListIds = new Set(mergedLists.map((l) => l.id));
      const newActiveId  = validListIds.has(prev.activeListId)
        ? prev.activeListId
        : (mergedLists[0]?.id ?? '');

      return {
        ...prev,
        lists:        mergedLists,
        // Always replace todos with server data once loaded (even if empty — user may have no tasks)
        todos:        serverTodos,
        stats:        serverStats,
        activeListId: newActiveId,
      };
    });
  }, [server.tasks, server.lists, server.momentum, server.loading, server.serverOnline]);

  const { lists, activeListId, todos, stats } = appState;

  const inAppNotifications = useInAppNotifications(todos, getActiveUserId());

  // UI state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultQuadrant, setDefaultQuadrant] = useState<Quadrant>('do');
  const [defaultDueDate, setDefaultDueDate] = useState('');
  const [showStreak, setShowStreak] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showTodayHistory, setShowTodayHistory] = useState(false);
  // Read once: what Back/refresh should restore the open panels to.
  const [initialScreen] = useState(() => readInitialScreen());
  // Remembered across reloads, same as tasksMode — a refresh must not always
  // dump you back on Tasks.
  const [activeView, setActiveView] = useLocalStorage<AppView>('hitlist-active-view', 'tasks');
  /** The sidebar's mobile sheet — desktop always shows it inline. */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Databases' own list, reported up since its state lives in DatabasesPage. */
  const [dbSidebarContext, setDbSidebarContext] = useState<ReactNode>(null);
  /** Calendar's "What's on it" section, reported up the same way. */
  const [calSidebarContext, setCalSidebarContext] = useState<ReactNode>(null);
  /** Notes' own list, reported up the same way. */
  const [notesSidebarContext, setNotesSidebarContext] = useState<ReactNode>(null);
  /** Nav count badges — showcase hides a view's own count while it's active. */
  const [notesCount, setNotesCount] = useState(0);
  const [dbCount, setDbCount] = useState(0);
  /** A note to open once Notes mounts — set from a task's "Note" chip, or restored. */
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(() => initialScreen?.noteId ?? null);
  /** The note NotesWorkspace currently has open — unlike pendingNoteId, this
   * doesn't clear itself once acted on; it's what Back/refresh should return to. */
  const [activeNoteId, setActiveNoteId] = useState<string | null>(() => initialScreen?.noteId ?? null);
  /** A task to open in the detail panel once tasks load — set on click, or restored. */
  const [pendingDetailTaskId, setPendingDetailTaskId] = useState<string | null>(() => initialScreen?.detailTaskId ?? null);
  // List vs Matrix is a mode within Tasks, remembered across reloads.
  const [tasksMode, setTasksMode] = useLocalStorage<TaskLayout>('hitlist-tasks-mode', 'matrix');
  // Grouping belongs to the layout it was chosen in: picking the board's columns
  // must not silently group the table by the same field. Each layout keeps its own.
  const [groupByByLayout, setGroupByByLayout] = useLocalStorage<Record<string, string>>('hitlist-groupby-v1', {});
  /**
   * A table's columns per list: which are hidden and their order. A view that is
   * open seeds this when applied, and Save writes it back into the view.
   */
  const [displayByList, setDisplayByList] = useLocalStorage<Record<string, ViewDisplay>>('hitlist-table-display-v1', {});
  /** The saved view whose tab is open, or null on a built-in tab. */
  const [appliedViewId, setAppliedViewId] = useState<string | null>(null);
  /** A database the calendar asked to open, handed to the Databases page once — or restored. */
  const [pendingDatabaseId, setPendingDatabaseId] = useState<string | null>(() => initialScreen?.databaseId ?? null);
  /** The database DatabasesPage currently has open — unlike pendingDatabaseId, this
   * doesn't clear itself once acted on; it's what Back/refresh should return to. */
  const [activeDatabaseId, setActiveDatabaseId] = useState<string | null>(() => initialScreen?.databaseId ?? null);

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeList = useMemo(
    () => lists.find((l) => l.id === activeListId) ?? lists[0],
    [lists, activeListId]
  );

  const listTodos = useMemo(
    () => todos.filter((t) => t.listId === activeListId),
    [todos, activeListId]
  );

  // ── Saved views ───────────────────────────────────────────────────────────
  const notifyViewError = useCallback((message: string) => toast.error(message, { duration: 3000 }), []);
  const savedViews = useSavedViews(notifyViewError);

  // ── Custom task fields ────────────────────────────────────────────────────
  const taskFields = useTaskFields(notifyViewError);
  const [fieldsManagerOpen, setFieldsManagerOpen] = useState(false);
  /** Which field the fields dialog opens on, when a table column menu asked for it. */
  const [fieldsManagerTarget, setFieldsManagerTarget] = useState<{ fieldId?: string; startNew?: boolean }>({});
  /** Where the fields popover hangs from — the control that opened it. */
  const [fieldsAnchor, setFieldsAnchor] = useState<AnchorRect | null>(null);

  // What the list and matrix show: the active list, narrowed by the filter bar.
  // Filtered here and not on the server on purpose — `todos` also feeds list
  // counts, date badges, note chips and the offline copy, and a filtered fetch
  // would replace all of them with the subset. See lib/taskFilters.
  const fieldContext = useMemo(
    () => ({ defs: taskFields.fields, values: taskFields.values }),
    [taskFields.fields, taskFields.values]
  );
  const visibleTodos = useMemo(
    () => applyTaskFilters(listTodos, filterState, undefined, fieldContext),
    [listTodos, filterState, fieldContext]
  );
  const taskCompare = useMemo(() => compareForFilters(filterState, fieldContext), [filterState, fieldContext]);
  // The table, and list groups by field, mix tasks from every quadrant.
  const crossQuadrantCompare = useMemo(
    () => compareAcrossQuadrants(filterState, fieldContext),
    [filterState, fieldContext]
  );
  const groupField = useMemo(() => groupFieldFor(filterState, taskFields.fields), [filterState, taskFields.fields]);

  const taskPanelFields = {
    defs: taskFields.fields,
    values: taskFields.values,
    online: taskFields.online,
    loading: taskFields.loading,
    onSetValue: (taskId: string, fieldId: string, value: FieldValue | null) => {
      void taskFields.setValue(taskId, fieldId, value);
    },
    onManage: () => { setFieldsAnchor(activeAnchor()); setFieldsManagerOpen(true); },
  };

  // A view shows as current whenever the screen matches it, rather than from
  // a remembered "last clicked" id that goes stale the moment a filter changes.
  const activeViewId = useMemo(() => savedViews.views.find((v) =>
    sameFilters(v.filters, filterState) &&
    v.showDone === showDone &&
    v.layout === tasksMode &&
    (!v.scopeListId || v.scopeListId === activeListId),
  )?.id ?? null, [savedViews.views, filterState, showDone, tasksMode, activeListId]);

  const handleApplyView = useCallback((view: ApiSavedView) => {
    if (view.scopeListId) {
      if (lists.some((l) => l.id === view.scopeListId)) {
        setAppState((prev) => ({ ...prev, activeListId: view.scopeListId! }));
      } else {
        toast.error("This view's list no longer exists", { description: 'Showing it in the open list instead.', duration: 3000 });
      }
    }
    setFilterState(normaliseFilters(view.filters));
    setShowDone(view.showDone);
    // A view saved as a calendar predates the Calendar view in the rail; show it
    // as a table rather than a layout the tasks page no longer has.
    setTasksMode(view.layout === 'calendar' ? 'table' : view.layout);
    setAppliedViewId(view.id);
    // The view's columns become the ones on screen for whichever list it opens.
    setDisplayByList((prev) => ({ ...prev, [view.scopeListId ?? activeListId]: view.display }));
    setDetailOpen(false);
  }, [lists, setTasksMode, setDisplayByList, activeListId]);

  const tableDisplay = displayByList[activeListId] ?? EMPTY_DISPLAY;

  const currentViewInput = useCallback((view: Pick<ApiSavedView, 'name' | 'scopeListId' | 'viewOrder'>) => ({
    name: view.name,
    layout: tasksMode,
    scopeListId: view.scopeListId,
    scopeDatabaseId: null,
    filters: filterState,
    showDone,
    display: displayByList[activeListId] ?? EMPTY_DISPLAY,
    viewOrder: view.viewOrder,
  }), [tasksMode, filterState, showDone, displayByList, activeListId]);

  const handleSaveView = useCallback(async (name: string, scopeToList: boolean) => {
    const created = await savedViews.createView({
      name, layout: tasksMode, scopeListId: scopeToList ? activeListId : null, scopeDatabaseId: null, filters: filterState, showDone,
    });
    if (created) toast.success(`Saved view "${created.name}"`, { duration: 2000 });
    return !!created;
  }, [savedViews, tasksMode, activeListId, filterState, showDone]);
  // A "Done" filter would otherwise show nothing while completed tasks are hidden.
  const showDoneEffective = showDone || filterState.status === 'DONE';

  const activeTodos = useMemo(() => listTodos.filter((t) => t.status !== 'done'), [listTodos]);
  const doneTodos = useMemo(() => listTodos.filter((t) => t.status === 'done'), [listTodos]);

  const totalCount = listTodos.length;
  const doneCount = doneTodos.length;
  // The badge counts what hides tasks. Sort and grouping still turn off manual
  // reorder, which is what activeFilterCount is for.
  const activeFilterCount = countActiveFilters(filterState);
  const narrowingFilterCount = countNarrowingFilters(filterState);

  /** Every column the table could show, in the order it shows them. */
  const tableColumnChoices = useMemo(() => sortByColumnOrder([
    { id: 'title', label: 'Title', fixed: true },
    { id: 'status', label: 'Status' },
    { id: 'quadrant', label: 'Quadrant' },
    { id: 'due', label: 'Due' },
    ...taskFields.fields.map((f) => ({ id: f.id, label: f.name })),
  ], displayByList[activeListId]?.order ?? []), [taskFields.fields, displayByList, activeListId]);

  const updateTableDisplay = useCallback((change: (current: ViewDisplay) => ViewDisplay) => {
    setDisplayByList((prev) => ({ ...prev, [activeListId]: change(prev[activeListId] ?? EMPTY_DISPLAY) }));
  }, [setDisplayByList, activeListId]);

  // Back returns to the previous screen instead of leaving the app.
  useHistoryState(
    useMemo(
      () => ({
        view: activeView, listId: activeListId, layout: tasksMode, viewId: appliedViewId,
        detailTaskId: detailOpen ? detailTodo?.id ?? null : null,
        noteId: activeNoteId, databaseId: activeDatabaseId,
      }),
      [activeView, activeListId, tasksMode, appliedViewId, detailOpen, detailTodo, activeNoteId, activeDatabaseId],
    ),
    useCallback((screen) => {
      setActiveView(
        screen.view === 'notes' || screen.view === 'databases' || screen.view === 'calendar'
          ? screen.view
          : 'tasks'
      );
      setAppState((prev) => ({ ...prev, activeListId: screen.listId }));
      setTasksMode(screen.layout as TaskLayout);
      setAppliedViewId(screen.viewId);
      setActiveNoteId(screen.noteId);
      setPendingNoteId(screen.noteId);
      setActiveDatabaseId(screen.databaseId);
      setPendingDatabaseId(screen.databaseId);
      if (screen.detailTaskId) {
        setPendingDetailTaskId(screen.detailTaskId);
      } else {
        setDetailOpen(false);
        setPendingDetailTaskId(null);
      }
    }, [setTasksMode]),
  );

  useEffect(() => {
    if (activeView === 'tasks' || activeView === 'notes' || activeView === 'databases' || activeView === 'calendar') {
      return;
    }
    setActiveView('tasks');
  }, [activeView, setActiveView]);

  const changeLayout = useCallback((next: TaskLayout) => {
    setGroupByByLayout((prev) => ({ ...prev, [tasksMode]: filterState.groupBy }));
    setFilterState((prev) => ({ ...prev, groupBy: groupByByLayout[next] ?? '' }));
    setTasksMode(next);
    // A built-in tab is not a saved view any more.
    setAppliedViewId(null);
  }, [tasksMode, filterState.groupBy, groupByByLayout, setGroupByByLayout, setTasksMode]);

  // The screen no longer matches the view whose tab is open — filters, or the
  // table's columns, which activeViewId does not look at.
  const appliedView = appliedViewId ? savedViews.views.find((v) => v.id === appliedViewId) : undefined;
  const viewDirty = appliedViewId !== null && (
    activeViewId !== appliedViewId ||
    (appliedView !== undefined && !sameDisplay(appliedView.display, displayByList[activeListId] ?? EMPTY_DISPLAY))
  );

  const handleCreateTabView = useCallback(async (input: NewViewInput) => {
    const groupBy = input.layout === 'board' ? input.groupBy
      : input.layout === 'table' ? filterState.groupBy
      : '';
    const created = await savedViews.createView({
      name: input.name,
      layout: input.layout,
      scopeListId: input.scopeToList ? activeListId : null,
      scopeDatabaseId: null,
      filters: { ...filterState, groupBy },
      showDone,
      display: displayByList[activeListId] ?? EMPTY_DISPLAY,
    });
    if (!created) return false;
    handleApplyView(created);
    toast.success(`Created "${created.name}"`, { duration: 2000 });
    return true;
  }, [savedViews, filterState, activeListId, showDone, handleApplyView]);

  const handleDuplicateView = useCallback(async (view: ApiSavedView) => {
    const copy = await savedViews.createView({
      name: `${view.name} copy`.slice(0, 100),
      layout: view.layout,
      scopeListId: view.scopeListId,
      scopeDatabaseId: view.scopeDatabaseId,
      filters: view.filters,
      showDone: view.showDone,
    });
    if (copy) { handleApplyView(copy); toast.success(`Created "${copy.name}"`, { duration: 2000 }); }
  }, [savedViews, handleApplyView]);

  const handleDeleteView = useCallback(async (view: ApiSavedView) => {
    const ok = await savedViews.deleteView(view.id);
    if (!ok) return;
    setAppliedViewId((current) => (current === view.id ? null : current));
    toast(`Deleted view "${view.name}"`, { duration: 2000 });
  }, [savedViews]);

  const handleSaveViewChanges = useCallback(async (view: ApiSavedView) => {
    const saved = await savedViews.updateView(view.id, currentViewInput({
      ...view, scopeListId: view.scopeListId ? activeListId : null,
    }));
    if (saved) { setAppliedViewId(saved.id); toast.success(`Updated "${saved.name}"`, { duration: 2000 }); }
  }, [savedViews, currentViewInput, activeListId]);

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
        const saved = apiTaskToTodo(created);
        setTodos((prev) => prev.map((t) => t.id === tempId ? saved : t));
        // Returned so a caller can act on the real id — the board's "+ Add"
        // sets the column's field value on the task it just created.
        return saved;
      }
      // Mutation failed — remove optimistic entry
      setTodos((prev) => prev.filter((t) => t.id !== tempId));
      toast.error('Failed to save task', { duration: 3000 });
      return null;
    },
    [activeListId, listTodos, setTodos, server]
  );

  /** "+ Add" in a board column: create the task, then give it that column's value. */
  const handleAddTaskInColumn = useCallback(async (title: string, columnKey: string) => {
    const created = await handleAddTask(title, 'do');
    // An ungrouped table passes no column, so there is no value to set.
    if (!created || !groupField || !columnKey) return;
    const value: FieldValue | null =
      columnKey === FIELD_EMPTY ? null
      : groupField.kind === 'checkbox' ? true
      : groupField.kind === 'multi' ? [columnKey]
      : columnKey;
    await taskFields.setValue(created.id, groupField.id, value);
  }, [handleAddTask, groupField, taskFields]);

  // The completion toast's Undo fires after later renders; a ref keeps it
  // calling the current handler rather than the one from when it was shown.
  const statusChangeRef = useRef<(id: string, status: TodoStatus) => Promise<void>>(async () => {});

  /**
   * A change the user can take back: does it, then offers Undo for a few
   * seconds. Dragging a card between board columns, moving a task on the
   * calendar and editing a table cell all go through this — a drag is easy to
   * do by accident and, before this, nothing said what the old value had been.
   *
   * The revert runs whatever the handler is at the time it is pressed, like the
   * completion toast above, rather than the closure from when it was shown.
   */
  const undoable = useCallback((what: string, apply: () => void, revert: () => void) => {
    apply();
    toast.success(what, {
      duration: 5000,
      action: { label: 'Undo', onClick: () => revert() },
    });
  }, []);

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
      } else {
        // The server removes the task's field values with it.
        taskFields.forgetTask(id);
      }
    },
    [todos, setTodos, server, taskFields]
  );

  const handleUpdate = useCallback(
    async (id: string, changes: Partial<Todo>, options?: { quiet?: boolean }) => {
      const prevTodo = todos.find((t) => t.id === id);
      // Optimistic update
      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
      setDetailTodo((prev) => (prev?.id === id ? { ...prev, ...changes } : prev));
      // Quiet for edits in table cells, which would otherwise toast on every cell.
      if (!options?.quiet) toast.success('Task updated', { duration: 1500 });

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

  // A task the detail panel should reopen once tasks load — set by Back/Forward
  // or a page refresh, mirroring DatabasesPage's own openDatabaseId effect.
  useEffect(() => {
    if (!pendingDetailTaskId) return;
    const t = todos.find((task) => task.id === pendingDetailTaskId);
    if (!t) return;
    handleOpenDetail(t);
    setPendingDetailTaskId(null);
  }, [pendingDetailTaskId, todos, handleOpenDetail]);

  const handleAddToQuadrant = useCallback((quadrant: Quadrant) => {
    setDefaultQuadrant(quadrant);
    setDialogOpen(true);
  }, []);

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

  /**
   * The "@" menu's create-task step: shared by the notes editor and a
   * database's text columns, which differ only in which pair of source ids
   * they stamp onto the created task (so each can later find its own linked
   * task, and "unlink" can tell which source to clear).
   */
  const createLinkedTask = useCallback(
    async (
      { listId, quadrant, title }: { listId: string; quadrant: Quadrant; title: string },
      source: { sourceNoteId?: string; sourceBlockId?: string; sourceRecordId?: string; sourceFieldId?: string },
    ) => {
      const maxOrder = todosRef.current
        .filter((t) => t.listId === listId)
        .reduce((m, t) => Math.max(m, t.order), -1);
      const quadrantMap: Record<Quadrant, import('@/lib/api').Quadrant> = {
        do: 'DO', schedule: 'SCHEDULE', delegate: 'DELEGATE', eliminate: 'ELIMINATE',
      };
      // The server only stores ids of this shape; anything else is linked from
      // the source side only rather than failing the whole create.
      const safeId = (v: string) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined);

      const created = await server.createTask({
        title,
        status: 'TODO',
        quadrant: quadrantMap[quadrant],
        listId,
        taskOrder: maxOrder + 1,
        sourceNoteId: source.sourceNoteId && safeId(source.sourceNoteId),
        sourceBlockId: source.sourceBlockId && safeId(source.sourceBlockId),
        sourceRecordId: source.sourceRecordId && safeId(source.sourceRecordId),
        sourceFieldId: source.sourceFieldId && safeId(source.sourceFieldId),
      });
      if (!created) {
        toast.error("Couldn't add it to the quadrant", { description: 'Nothing here changed.', duration: 3000 });
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

  const handleCreateLinkedTask = useCallback<NoteTaskLinking['createTask']>(
    ({ listId, quadrant, title, noteId, blockId }) =>
      createLinkedTask({ listId, quadrant, title }, { sourceNoteId: noteId, sourceBlockId: blockId }),
    [createLinkedTask],
  );

  const handleCreateLinkedTaskFromRecord = useCallback<DatabaseTaskLinking['createTask']>(
    ({ listId, quadrant, title, recordId, fieldId }) =>
      createLinkedTask({ listId, quadrant, title }, { sourceRecordId: recordId, sourceFieldId: fieldId }),
    [createLinkedTask],
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

  /** Unlink from its note or database source: clears the task's source, keeps the task. */
  const handleUnlinkTask = useCallback((taskId: string) => {
    const current = todosRef.current.find((t) => t.id === taskId);
    if (!current?.sourceNoteId && !current?.sourceBlockId && !current?.sourceRecordId && !current?.sourceFieldId) return;
    setTodos((prev) => prev.map((t) => (
      t.id === taskId
        ? { ...t, sourceNoteId: undefined, sourceBlockId: undefined, sourceRecordId: undefined, sourceFieldId: undefined }
        : t
    )));
    void server.updateTask(taskId, { sourceNoteId: '', sourceBlockId: '', sourceRecordId: '', sourceFieldId: '' });
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

  const databaseLinking = useMemo<DatabaseTaskLinking>(() => ({
    lists,
    todos,
    tasksLoaded: !server.loading,
    preferredListId: activeListId,
    createTask: handleCreateLinkedTaskFromRecord,
    updateTaskTitle: handleUpdateLinkedTaskTitle,
    unlinkTask: handleUnlinkTask,
    openTask: handleOpenLinkedTask,
  }), [lists, todos, server.loading, activeListId, handleCreateLinkedTaskFromRecord, handleUpdateLinkedTaskTitle, handleUnlinkTask, handleOpenLinkedTask]);

  const handleOpenNoteHandled = useCallback(() => setPendingNoteId(null), []);

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

  const tasksTopBar = (
    <TopBar
      dotClass={activeList ? getListColorDot(activeList.color) : undefined}
      title={activeList?.name ?? 'Tasks'}
      subtitle={`${totalCount} task${totalCount !== 1 ? 's' : ''} · ${stats.todayCompleted} done today`}
      attention={alertCount > 0 ? `${alertCount} need${alertCount === 1 ? 's' : ''} attention` : undefined}
      tabs={
        <TopBarToggle
          label="Task view"
          value={tasksMode}
          onChange={changeLayout}
          options={[
            { value: 'list', label: 'List' },
            { value: 'matrix', label: 'Matrix' },
            { value: 'table', label: 'Table' },
            { value: 'board', label: 'Board' },
          ]}
        />
      }
      actions={
        <>
          {/* One quiet pill for everything that narrows or tidies the view. It
              was a filter bar in the scroll column, which scrolled away. */}
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={topBarPill} aria-label={`Filter${narrowingFilterCount ? ` (${narrowingFilterCount} active)` : ''}`}>
                <SlidersHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden />
                <span className="hidden sm:inline">Filter</span>
                {narrowingFilterCount > 0 && (
                  <span className="flex min-w-[18px] items-center justify-center rounded-[3px] bg-a-accent px-1 text-[11px] font-bold leading-[18px] text-a-surface">
                    {narrowingFilterCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={-36} alignOffset={-4} className="w-[min(92vw,560px)] rounded-[12px] border border-a-line p-4 shadow-[var(--a-shadow-xl)]">
              <FilterPanel
                filters={filterState}
                onChange={setFilterState}
                fieldDefs={taskFields.fields}
                layout={tasksMode}
                showDone={showDone}
                onShowDoneChange={setShowDone}
                doneCount={doneCount}
                onClearDone={handleClearDone}
                listName={activeList?.name ?? 'this list'}
                onSaveView={handleSaveView}
              />
            </PopoverContent>
          </Popover>

          <button
            type="button"
            onClick={() => { setDefaultQuadrant('do'); setDialogOpen(true); }}
            className={topBarPrimary}
            aria-label="New task"
          >
            <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">New</span>
          </button>
        </>
      }
    />
  );

  const shellView = activeView === 'notes' || activeView === 'databases' || activeView === 'calendar' ? activeView : 'tasks';
  const crumb1 = shellView === 'notes' ? 'Notes' : shellView === 'databases' ? 'Databases' : shellView === 'calendar' ? 'Calendar' : 'Tasks';
  const crumb2 = shellView === 'tasks' ? activeList?.name : undefined;
  const syncStatus: { tone: 'success' | 'warning' | 'danger'; label: string } = server.error
    ? { tone: 'danger', label: 'Error' }
    : !server.serverOnline
    ? { tone: 'warning', label: 'Offline' }
    : server.saving
    ? { tone: 'warning', label: 'Syncing' }
    : { tone: 'success', label: 'Saved' };

  return (
    <>
      <Toaster position="top-center" richColors />

      <NotificationToast
        freshRecords={inAppNotifications.freshToastRecords}
        onDismiss={inAppNotifications.dismiss}
        onMarkSeen={inAppNotifications.markToastSeen}
      />

      <AppShell
        rail={
          <Sidebar
            activeView={shellView}
            onViewChange={setActiveView}
            counts={{ tasks: totalCount, notes: notesCount, databases: dbCount }}
            mobileOpen={sidebarOpen}
            onMobileOpenChange={setSidebarOpen}
            context={shellView === 'tasks' ? (
              <>
                <SavedViewsSection
                  views={savedViews.views}
                  lists={lists}
                  activeViewId={activeViewId}
                  online={savedViews.online}
                  onApply={handleApplyView}
                  onRename={(view, name) => { void savedViews.updateView(view.id, { ...view, name }); }}
                  onUpdateToCurrent={(view) => {
                    // A scoped view stays scoped, to whichever list is open now.
                    void savedViews.updateView(view.id, currentViewInput({
                      ...view, scopeListId: view.scopeListId ? activeListId : null,
                    })).then((saved) => { if (saved) toast.success(`Updated "${saved.name}"`, { duration: 2000 }); });
                  }}
                  onDelete={(view) => {
                    void savedViews.deleteView(view.id).then((ok) => {
                      if (ok) toast(`Deleted view "${view.name}"`, { duration: 2000 });
                    });
                  }}
                />
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
              </>
            ) : shellView === 'databases' ? dbSidebarContext : shellView === 'calendar' ? calSidebarContext : shellView === 'notes' ? notesSidebarContext : null}
            contextFoot={shellView === 'tasks' ? (
              <>
                {/* Momentum moved here from a card at the top of the page. */}
                <MomentumBar
                  stats={stats}
                  total={totalCount}
                  done={doneCount}
                  onViewHistory={() => setShowTodayHistory(true)}
                  onViewProgress={() => setShowStreak(true)}
                />
              </>
            ) : undefined}
          />
        }
      >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader
          crumb1={crumb1}
          crumb2={crumb2}
          sync={syncStatus}
          bell={
            <NotificationBell
              notifications={inAppNotifications.notifications}
              unreadCount={inAppNotifications.unreadCount}
              onDismiss={inAppNotifications.dismiss}
              onDismissAll={inAppNotifications.dismissAll}
              onNavigateToTask={(taskId) => {
                const t = todos.find((x) => x.id === taskId);
                if (t) { setActiveView('tasks'); handleOpenDetail(t); }
              }}
            />
          }
          account={<UserMenu />}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        {activeView === 'notes' ? (
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <NotesWorkspace
              linking={noteLinking}
              openNoteId={pendingNoteId}
              onOpenNoteHandled={handleOpenNoteHandled}
              onActiveNoteChange={setActiveNoteId}
              onSidebarContentChange={setNotesSidebarContext}
              onOpenSidebar={() => setSidebarOpen(true)}
              onCountChange={setNotesCount}
            />
          </div>
        ) : activeView === 'databases' ? (
          <DatabasesPage
            openDatabaseId={pendingDatabaseId}
            onOpenHandled={() => setPendingDatabaseId(null)}
            onOpenChange={setActiveDatabaseId}
            linking={databaseLinking}
            onSidebarContentChange={setDbSidebarContext}
            onOpenSidebar={() => setSidebarOpen(true)}
            onCountChange={setDbCount}
          />
        ) : activeView === 'calendar' ? (
          <CalendarPage
            lists={lists}
            onOpenTask={(taskId) => {
              const t = todos.find((x) => x.id === taskId);
              if (t) { setActiveView('tasks'); handleOpenDetail(t); }
            }}
            onOpenDatabase={(databaseId) => { setPendingDatabaseId(databaseId); setActiveView('databases'); }}
            onSidebarContentChange={setCalSidebarContext}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : (
          // The sidebar (rail, above) now owns the context column; this just
          // needs the page header + a scrolling content pane. `openContext`
          // redirects to the sidebar's own mobile sheet so TopBar's existing
          // mobile menu button keeps working without TopBar itself changing.
          <ViewLayoutContext.Provider value={{
            openContext: () => setSidebarOpen(true),
            closeContext: () => setSidebarOpen(false),
            toggleCollapsed: () => {},
            collapsible: false,
            collapsed: false,
          }}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {tasksTopBar}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {/* Sync status: shows only while saving, offline, or erroring — with Retry. */}
            <SyncStatusBar
              error={server.error}
              // Not "offline" until the first response is in — the skeleton owns that wait.
              serverOnline={server.serverOnline || server.loading}
              onRetry={server.refresh}
              onDismissError={server.clearError}
            />

            <div className="px-4 pt-4 pb-12 md:px-12">
              {/* The prototype's Board screen has no chip row; it appears there only once a board
                  has been saved as a view (Filter → Save as view still creates one). */}
              {!server.loading && visibleTodos.length > 0 && (tasksMode === 'table' || (tasksMode === 'board'
                && savedViews.views.some((v) => v.layout === 'board' && (!v.scopeListId || v.scopeListId === activeListId)))) && (
                <ViewTabs
                  layout={tasksMode}
                  views={savedViews.views}
                  appliedViewId={appliedViewId}
                  dirty={viewDirty}
                  listId={activeListId}
                  listName={activeList?.name ?? 'this list'}
                  online={savedViews.online}
                  groupFields={taskFields.fields.filter(isGroupableField)}
                  onSelectLayout={changeLayout}
                  onApplyView={handleApplyView}
                  onCreate={handleCreateTabView}
                  onRename={(view, name) => { void savedViews.updateView(view.id, { ...view, name }); }}
                  onDuplicate={(view) => { void handleDuplicateView(view); }}
                  onDelete={(view) => { void handleDeleteView(view); }}
                  onSaveChanges={(view) => { void handleSaveViewChanges(view); }}
                  onResetChanges={handleApplyView}
                  onManageFields={() => { setFieldsAnchor(activeAnchor()); setFieldsManagerOpen(true); }}
                  trailing={tasksMode === 'table' ? (
                    <div className="flex flex-shrink-0 items-center gap-2">
                    <ColumnsMenu
                      columns={tableColumnChoices}
                      hidden={tableDisplay.hidden}
                      onToggle={(columnId) => updateTableDisplay((d) => ({
                        ...d,
                        hidden: d.hidden.includes(columnId)
                          ? d.hidden.filter((id) => id !== columnId)
                          : [...d.hidden, columnId],
                      }))}
                      onMove={(columnId, direction) => updateTableDisplay((d) => ({
                        ...d, order: moveColumn(tableColumnChoices.map((c) => c.id), columnId, direction),
                      }))}
                      onReset={() => updateTableDisplay(() => EMPTY_DISPLAY)}
                    />
                    <button
                      type="button"
                      onClick={() => { setFieldsAnchor(activeAnchor()); setFieldsManagerOpen(true); }}
                      className={topBarSecondary}
                    >
                      <SlidersHorizontal className="size-3.5" strokeWidth={1.75} aria-hidden />
                      Fields
                    </button>
                    </div>
                  ) : undefined}
                />
              )}
              {server.loading ? (
                <div aria-busy="true">
                  <LoadingSkeleton layout={tasksMode} />
                  <p className="mt-4 text-center text-[13px] text-a-faint" role="status">Loading tasks from the server…</p>
                </div>
              ) : listTodos.length === 0 ? (
                <EmptyState
                  image={ILL.noData}
                  title={`No tasks in ${activeList?.name ?? 'this list'} yet`}
                  description="Add your first task, or turn a line in a note into one with @. Tasks land in the Eisenhower quadrant you pick."
                  action={
                    <button
                      type="button"
                      onClick={() => { setDefaultQuadrant('do'); setDialogOpen(true); }}
                      className={cn(topBarPrimary, BTN_MD)}
                    >
                      <Plus className="size-[15px]" strokeWidth={1.75} aria-hidden />
                      Add task
                    </button>
                  }
                />
              ) : visibleTodos.length === 0 ? (
                <NoMatchingTasks
                  hidden={listTodos.length}
                  clauses={describeActiveFilters(filterState, taskFields.fields)}
                  onClear={() => setFilterState(DEFAULT_FILTERS)}
                />
              ) : tasksMode === 'list' ? (
                <TaskListView
                  todos={visibleTodos}
                  compare={taskCompare}
                  fieldDefs={taskFields.fields}
                  fieldValues={taskFields.values}
                  groupField={groupField}
                  groupCompare={crossQuadrantCompare}
                  showDone={showDoneEffective}
                  nextId={nextId}
                  dragDisabled={activeFilterCount > 0}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onOpen={handleOpenDetail}
                  onAddToQuadrant={handleAddToQuadrant}
                  onReorder={handleReorder}
                  onOpenNote={handleOpenSourceNote}
                />
              ) : tasksMode === 'board' ? (
                <TaskBoardView
                  todos={visibleTodos}
                  showDone={showDoneEffective}
                  compare={crossQuadrantCompare}
                  groupField={groupField}
                  fieldDefs={taskFields.fields}
                  fieldValues={taskFields.values}
                  fieldsOnline={taskFields.online}
                  fieldsLoading={taskFields.loading}
                  nextId={nextId}
                  onGroupFieldChange={(fieldId) => setFilterState({ ...filterState, groupBy: fieldId })}
                  onManageFields={() => { setFieldsAnchor(activeAnchor()); setFieldsManagerTarget({}); setFieldsManagerOpen(true); }}
                  onSetFieldValue={(taskId, fieldId, value) => {
                    const before = taskFields.values[taskId]?.[fieldId] ?? null;
                    undoable('Moved', () => { void taskFields.setValue(taskId, fieldId, value); },
                      () => { void taskFields.setValue(taskId, fieldId, before); });
                  }}
                  onAddTask={(title, columnKey) => { void handleAddTaskInColumn(title, columnKey); }}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onOpen={handleOpenDetail}
                  onOpenNote={handleOpenSourceNote}
                />
              ) : tasksMode === 'table' ? (
                <TaskTableView
                  todos={visibleTodos}
                  showDone={showDoneEffective}
                  compare={crossQuadrantCompare}
                  sortBy={filterState.sortBy}
                  sortDir={filterState.sortDir}
                  onSortChange={(sortBy, sortDir) => setFilterState({ ...filterState, sortBy, sortDir })}
                  groupField={groupField}
                  fieldDefs={taskFields.fields}
                  fieldValues={taskFields.values}
                  onStatusChange={handleStatusChange}
                  onUpdate={(id, changes) => {
                    const before = todos.find((t) => t.id === id);
                    const previous = Object.fromEntries(
                      Object.keys(changes).map((key) => [key, before?.[key as keyof Todo] ?? '']),
                    ) as Partial<Todo>;
                    undoable('Task updated', () => { void handleUpdate(id, changes, { quiet: true }); },
                      () => { void handleUpdate(id, previous, { quiet: true }); });
                  }}
                  onSetFieldValue={(taskId, fieldId, value) => {
                    const before = taskFields.values[taskId]?.[fieldId] ?? null;
                    undoable('Saved', () => { void taskFields.setValue(taskId, fieldId, value); },
                      () => { void taskFields.setValue(taskId, fieldId, before); });
                  }}
                  onOpen={handleOpenDetail}
                  onDelete={handleDelete}
                  onAddTask={(title, groupKey) => { void handleAddTaskInColumn(title, groupKey); }}
                  hiddenColumns={tableDisplay.hidden}
                  columnOrder={tableDisplay.order}
                  onHideColumn={(columnId) => updateTableDisplay((d) => ({
                    ...d, hidden: [...new Set([...d.hidden, columnId])],
                  }))}
                  onEditField={(fieldId) => { setFieldsAnchor(activeAnchor()); setFieldsManagerTarget({ fieldId }); setFieldsManagerOpen(true); }}
                  onCreateField={() => { setFieldsAnchor(activeAnchor()); setFieldsManagerTarget({ startNew: true }); setFieldsManagerOpen(true); }}
                  onDeleteField={(fieldId) => { void taskFields.deleteField(fieldId); }}
                />
              ) : (
                <EisenhowerMatrix
                  todos={visibleTodos}
                  compare={taskCompare}
                  fieldDefs={taskFields.fields}
                  fieldValues={taskFields.values}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onOpen={handleOpenDetail}
                  onAddToQuadrant={handleAddToQuadrant}
                  nextId={nextId}
                  showDone={showDoneEffective}
                  onOpenNote={handleOpenSourceNote}
                />
              )}
            </div>
            </div>
          </div>
          </ViewLayoutContext.Provider>
        )}
      </div>
      </AppShell>

      {/* Add task dialog */}
      <AddTaskDialog
        open={dialogOpen}
        defaultQuadrant={defaultQuadrant}
        defaultDueDate={defaultDueDate}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setDefaultDueDate(''); }}
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

      {/* Weekly progress — reached from the momentum foot. */}
      <Dialog open={showStreak} onOpenChange={setShowStreak}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Weekly progress</DialogTitle>
            <DialogDescription>{activeList?.name ?? 'This list'} · {weekRangeLabel()}</DialogDescription>
          </DialogHeader>
          <StreakPanel todos={listTodos} onClose={() => setShowStreak(false)} />
        </DialogContent>
      </Dialog>

      {/* Task detail panel */}
      <TaskDetailPanel
        todo={detailTodo}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onOpenNote={handleOpenSourceNote}
        listName={activeList?.name}
        fields={taskPanelFields}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onStatusChange={handleStatusChange}
      />

      <FieldsManagerDialog
        open={fieldsManagerOpen}
        anchor={fieldsAnchor}
        initialFieldId={fieldsManagerTarget.fieldId ?? null}
        startNew={fieldsManagerTarget.startNew ?? false}
        onOpenChange={setFieldsManagerOpen}
        fields={taskFields.fields}
        onCreate={async (input) => {
          const created = await taskFields.createField(input);
          if (created) toast.success(`Created field "${created.name}"`, { duration: 2000 });
          return created;
        }}
        onUpdate={taskFields.updateField}
        onDelete={taskFields.deleteField}
        optionUsage={(fieldId, optionId) => Object.values(taskFields.values).filter((v) => {
          const x = v[fieldId];
          return x === optionId || (Array.isArray(x) && x.includes(optionId));
        }).length}
        fieldUsage={(fieldId) => ({
          valueCount: Object.values(taskFields.values).filter((v) => v[fieldId] !== undefined).length,
          viewNames: savedViews.views
            .filter((v) => v.filters.groupBy === fieldId || v.filters.fields?.[fieldId] || v.filters.sortBy === `field:${fieldId}`)
            .map((v) => v.name),
        })}
      />
    </>
  );
}

// Retained for the error states it renders; unused by the current layout,
// which routes errors through SyncStatusBar.
void ErrorBanner;

export default App;
