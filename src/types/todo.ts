export type TodoStatus = 'todo' | 'in-progress' | 'done';

/** Eisenhower Matrix quadrant */
export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate';

export interface QuadrantConfig {
  id: Quadrant;
  label: string;
  subtitle: string;
  urgentLabel: string;
  importantLabel: string;
  isUrgent: boolean;
  isImportant: boolean;
  accentClass: string;       // border/ring accent
  bgClass: string;           // subtle quadrant bg
  badgeClass: string;        // badge color
  headerClass: string;       // header bg
  emptyIcon: string;
}

export const QUADRANTS: QuadrantConfig[] = [
  {
    id: 'do',
    label: 'Do First',
    subtitle: 'Urgent & Important',
    urgentLabel: 'Urgent',
    importantLabel: 'Important',
    isUrgent: true,
    isImportant: true,
    accentClass: 'border-rose-500/40 ring-rose-500/10',
    bgClass: 'bg-rose-500/[0.03]',
    badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    headerClass: 'bg-rose-500/8 border-rose-500/20',
    emptyIcon: '🔥',
  },
  {
    id: 'schedule',
    label: 'Schedule',
    subtitle: 'Not Urgent & Important',
    urgentLabel: 'Not Urgent',
    importantLabel: 'Important',
    isUrgent: false,
    isImportant: true,
    accentClass: 'border-blue-500/40 ring-blue-500/10',
    bgClass: 'bg-blue-500/[0.03]',
    badgeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    headerClass: 'bg-blue-500/8 border-blue-500/20',
    emptyIcon: '📅',
  },
  {
    id: 'delegate',
    label: 'Delegate',
    subtitle: 'Urgent & Not Important',
    urgentLabel: 'Urgent',
    importantLabel: 'Not Important',
    isUrgent: true,
    isImportant: false,
    accentClass: 'border-amber-500/40 ring-amber-500/10',
    bgClass: 'bg-amber-500/[0.03]',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    headerClass: 'bg-amber-500/8 border-amber-500/20',
    emptyIcon: '🤝',
  },
  {
    id: 'eliminate',
    label: 'Eliminate',
    subtitle: 'Not Urgent & Not Important',
    urgentLabel: 'Not Urgent',
    importantLabel: 'Not Important',
    isUrgent: false,
    isImportant: false,
    accentClass: 'border-border ring-border/10',
    bgClass: 'bg-muted/20',
    badgeClass: 'bg-muted text-muted-foreground',
    headerClass: 'bg-muted/40 border-border',
    emptyIcon: '🗑️',
  },
];

export function getQuadrantConfig(id: Quadrant): QuadrantConfig {
  return QUADRANTS.find((q) => q.id === id) ?? QUADRANTS[0];
}

export interface Todo {
  id: string;
  text: string;
  status: TodoStatus;
  createdAt: number;
  completedAt?: number;
  note?: string;
  dueDate?: string;      // ISO date string YYYY-MM-DD
  dueTime?: string;      // HH:MM (24h)
  category?: string;
  listId: string;
  order: number;
  quadrant: Quadrant;    // Eisenhower Matrix quadrant
  reminderEnabled?: boolean;       // whether reminder is active
  reminderMinutesBefore?: number;  // minutes before due to fire (5/15/30/60)
}

export interface KaizenList {
  id: string;
  name: string;
  createdAt: number;
  color: string; // tailwind color token key
}

export interface KaizenStats {
  streak: number;
  totalCompleted: number;
  todayCompleted: number;
}

export interface AppState {
  lists: KaizenList[];
  activeListId: string;
  todos: Todo[];
  stats: KaizenStats;
  lastStreakDay: string;
  version: number;
}

export const CATEGORIES = [
  { id: 'personal', label: 'Personal', color: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  { id: 'work', label: 'Work', color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  { id: 'health', label: 'Health', color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  { id: 'learning', label: 'Learning', color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  { id: 'creative', label: 'Creative', color: 'bg-pink-500/15 text-pink-600 dark:text-pink-400' },
] as const;

export type CategoryId = typeof CATEGORIES[number]['id'];

export function getCategoryConfig(id?: string) {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}

// ── In-app notification records ──────────────────────────────────────────────

export type InAppNotificationType = 'upcoming' | 'missed';

export interface NotificationRecord {
  id: string;           // unique record id
  taskId: string;       // which task triggered this
  taskText: string;     // snapshot of task text at trigger time
  quadrant: Quadrant;   // snapshot of quadrant
  type: InAppNotificationType;
  triggeredAt: number;  // ms epoch when record was created
  dismissed: boolean;
  minutesBefore?: number; // for 'upcoming' type
  seenInToast?: boolean;  // whether it has been shown in the toast stack
}

export type SortOption = 'created' | 'due-date' | 'status' | 'order';
export type GroupOption = 'none' | 'category';

export const LIST_COLORS = [
  { id: 'emerald', label: 'Emerald', dot: 'bg-emerald-500' },
  { id: 'violet', label: 'Violet', dot: 'bg-violet-500' },
  { id: 'blue', label: 'Blue', dot: 'bg-blue-500' },
  { id: 'amber', label: 'Amber', dot: 'bg-amber-500' },
  { id: 'rose', label: 'Rose', dot: 'bg-rose-500' },
  { id: 'sky', label: 'Sky', dot: 'bg-sky-500' },
] as const;

export type ListColorId = typeof LIST_COLORS[number]['id'];

export function getListColorDot(colorId: string): string {
  return LIST_COLORS.find((c) => c.id === colorId)?.dot ?? 'bg-emerald-500';
}
