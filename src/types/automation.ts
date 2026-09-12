// ── Automation / Reminder Rule Types ─────────────────────────────────────────

export type AutomationStatus = 'active' | 'paused' | 'draft';

export type TriggerType =
  | 'due-date'      // fire N minutes/hours before due date
  | 'overdue'       // fire when task becomes overdue
  | 'recurring'     // fire on a recurring schedule
  | 'status-change' // fire when task status changes
  | 'daily-digest'; // fire once per day as a summary

export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export type ReminderOffsetUnit = 'minutes' | 'hours' | 'days';

export interface ReminderOffset {
  value: number;
  unit: ReminderOffsetUnit;
}

export interface RecurrenceSchedule {
  frequency: RecurrenceFrequency;
  time: string;        // HH:MM (24h)
  dayOfWeek?: number;  // 0=Sun … 6=Sat (for weekly)
  dayOfMonth?: number; // 1–31 (for monthly)
}

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  taskId?: string;          // linked task id (undefined = applies globally)
  taskTitle?: string;       // snapshot of task title for display
  triggerType: TriggerType;
  status: AutomationStatus;
  urgency: UrgencyLevel;
  reminderOffset?: ReminderOffset;      // for due-date trigger
  recurrence?: RecurrenceSchedule;      // for recurring / daily-digest
  notifyInApp: boolean;
  notifyBrowser: boolean;
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt?: number;
  nextTriggerAt?: number;
}

// ── Form shape (subset used in create/edit form) ──────────────────────────────

export interface AutomationRuleFormValues {
  name: string;
  description: string;
  taskId: string;           // '' = no task linked
  triggerType: TriggerType;
  status: AutomationStatus;
  urgency: UrgencyLevel;
  // reminder offset
  offsetValue: string;      // string for input binding
  offsetUnit: ReminderOffsetUnit;
  // recurrence
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceTime: string;
  recurrenceDayOfWeek: string;
  recurrenceDayOfMonth: string;
  notifyInApp: boolean;
  notifyBrowser: boolean;
}

export const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  'due-date':     'Before due date',
  'overdue':      'When overdue',
  'recurring':    'Recurring schedule',
  'status-change':'On status change',
  'daily-digest': 'Daily digest',
};

export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  low:      'Low',
  medium:   'Medium',
  high:     'High',
  critical: 'Critical',
};

export const URGENCY_COLORS: Record<UrgencyLevel, string> = {
  low:      'bg-muted text-muted-foreground',
  medium:   'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  high:     'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  critical: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export const STATUS_COLORS: Record<AutomationStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  draft:  'bg-muted text-muted-foreground',
};

export const STATUS_DOT: Record<AutomationStatus, string> = {
  active: 'bg-emerald-500',
  paused: 'bg-amber-500',
  draft:  'bg-muted-foreground/40',
};
