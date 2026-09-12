import { memo } from 'react';
import {
  Bell,
  Calendar,
  Clock,
  Repeat,
  Zap,
  BookOpen,
  ToggleLeft,
  ToggleRight,
  Pencil,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { AutomationRule, TriggerType, UrgencyLevel, AutomationStatus } from '@/types/automation';
import {
  TRIGGER_TYPE_LABELS,
  URGENCY_LABELS,
  URGENCY_COLORS,
  STATUS_COLORS,
  STATUS_DOT,
} from '@/types/automation';

// ── Trigger icon map ──────────────────────────────────────────────────────────

const TRIGGER_ICONS: Record<TriggerType, React.ElementType> = {
  'due-date':      Clock,
  'overdue':       AlertTriangle,
  'recurring':     Repeat,
  'status-change': Zap,
  'daily-digest':  BookOpen,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatNextTrigger(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d`;
}

function formatOffset(rule: AutomationRule): string {
  if (rule.triggerType === 'due-date' && rule.reminderOffset) {
    const { value, unit } = rule.reminderOffset;
    return `${value} ${unit} before due`;
  }
  if (rule.recurrence) {
    const { frequency, time, dayOfWeek, dayOfMonth } = rule.recurrence;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (frequency === 'weekly' && dayOfWeek !== undefined) {
      return `Every ${days[dayOfWeek]} at ${time}`;
    }
    if (frequency === 'monthly' && dayOfMonth !== undefined) {
      return `Monthly on day ${dayOfMonth} at ${time}`;
    }
    const label =
      frequency === 'weekdays'
        ? 'Weekdays'
        : frequency.charAt(0).toUpperCase() + frequency.slice(1);
    return `${label} at ${time}`;
  }
  return TRIGGER_TYPE_LABELS[rule.triggerType];
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyAutomations({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-fade-in">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/8 border border-primary/15 mb-5">
        <Zap className="size-7 text-primary/60" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-2">No automation rules yet</h3>
      <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-6">
        Create rules to automatically remind you about tasks, send daily digests, or escalate overdue items.
      </p>
      <Button onClick={onNew} className="rounded-xl gap-2 px-5">
        <Zap className="size-3.5" />
        Create your first rule
      </Button>
    </div>
  );
}

// ── Rule card ─────────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: AutomationRule;
  onEdit: (rule: AutomationRule) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRunNow?: (id: string) => void;
}

const RuleCard = memo(function RuleCard({
  rule,
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
}: RuleCardProps) {
  const TriggerIcon = TRIGGER_ICONS[rule.triggerType];
  const isActive = rule.status === 'active';
  const isPaused = rule.status === 'paused';

  return (
    <div
      className={cn(
        'group relative rounded-2xl border bg-card p-5 transition-all duration-200',
        'hover:shadow-md hover:border-border/80',
        isActive ? 'border-border' : 'border-border/50 opacity-80 hover:opacity-100'
      )}
    >
      {/* Top row */}
      <div className="flex items-start gap-3">
        {/* Trigger icon */}
        <div
          className={cn(
            'flex size-9 flex-shrink-0 items-center justify-center rounded-xl border transition-colors duration-200',
            isActive
              ? 'bg-primary/8 border-primary/20 text-primary'
              : 'bg-muted/50 border-border/50 text-muted-foreground'
          )}
        >
          <TriggerIcon className="size-4" />
        </div>

        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground leading-tight truncate">
              {rule.name}
            </h3>
            {/* Status badge */}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0',
                STATUS_COLORS[rule.status]
              )}
            >
              <span className={cn('size-1.5 rounded-full', STATUS_DOT[rule.status])} />
              {rule.status}
            </span>
            {/* Urgency badge */}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0',
                URGENCY_COLORS[rule.urgency]
              )}
            >
              {URGENCY_LABELS[rule.urgency]}
            </span>
          </div>

          {/* Description */}
          {rule.description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
              {rule.description}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(rule)}
            aria-label="Edit rule"
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(rule.id)}
            aria-label="Delete rule"
            className="size-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Meta row */}
      <div className="mt-3.5 flex items-center gap-4 flex-wrap">
        {/* Trigger type */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="size-3 flex-shrink-0" />
          <span>{formatOffset(rule)}</span>
        </div>

        {/* Linked task */}
        {rule.taskTitle && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
            <ExternalLink className="size-3 flex-shrink-0" />
            <span className="truncate max-w-[180px]" title={rule.taskTitle}>
              {rule.taskTitle}
            </span>
          </div>
        )}

        {/* Notification channels */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bell className="size-3 flex-shrink-0" />
          <span>
            {[rule.notifyInApp && 'In-app', rule.notifyBrowser && 'Browser']
              .filter(Boolean)
              .join(' · ') || 'No notifications'}
          </span>
        </div>
      </div>

      {/* Last / next trigger row */}
      <div className="mt-2.5 flex items-center gap-4 flex-wrap">
        {rule.lastTriggeredAt && (
          <span className="text-[11px] text-muted-foreground/70">
            Last triggered {formatRelativeTime(rule.lastTriggeredAt)}
          </span>
        )}
        {rule.nextTriggerAt && isActive && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
            Next: {formatNextTrigger(rule.nextTriggerAt)}
          </span>
        )}
        {!rule.lastTriggeredAt && !rule.nextTriggerAt && (
          <span className="text-[11px] text-muted-foreground/50">Never triggered</span>
        )}
      </div>

      {/* Toggle enable/disable + Run Now */}
      <div className="mt-4 pt-3.5 border-t border-border/60 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {isActive ? 'Rule is active' : isPaused ? 'Rule is paused' : 'Draft — not active'}
        </span>
        <div className="flex items-center gap-2">
          {onRunNow && isActive && (
            <button
              type="button"
              onClick={() => onRunNow(rule.id)}
              aria-label="Run rule now"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 text-primary hover:bg-primary/10"
            >
              <Play className="size-3.5" /> Run Now
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggle(rule.id)}
            aria-label={isActive ? 'Pause rule' : 'Activate rule'}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150',
              isActive
                ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
            )}
          >
            {isActive ? (
              <><ToggleRight className="size-4" /> Pause</>
            ) : (
              <><ToggleLeft className="size-4" /> Activate</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

// ── Filter bar ────────────────────────────────────────────────────────────────

type FilterStatus = 'all' | AutomationStatus;

interface FilterBarProps {
  filter: FilterStatus;
  onChange: (f: FilterStatus) => void;
  counts: Record<FilterStatus, number>;
}

function FilterBar({ filter, onChange, counts }: FilterBarProps) {
  const options: { id: FilterStatus; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'paused', label: 'Paused' },
    { id: 'draft', label: 'Draft' },
  ];

  return (
    <div className="flex items-center gap-1 rounded-xl bg-muted/40 p-1">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150',
            filter === opt.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {opt.label}
          {counts[opt.id] > 0 && (
            <span
              className={cn(
                'flex size-4 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums',
                filter === opt.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
              )}
            >
              {counts[opt.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── AutomationList (exported) ─────────────────────────────────────────────────

interface AutomationListProps {
  rules: AutomationRule[];
  filter: FilterStatus;
  onFilterChange: (f: FilterStatus) => void;
  onNew: () => void;
  onEdit: (rule: AutomationRule) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRunNow?: (id: string) => void;
}

export function AutomationList({
  rules,
  filter,
  onFilterChange,
  onNew,
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
}: AutomationListProps) {
  const counts: Record<FilterStatus, number> = {
    all: rules.length,
    active: rules.filter((r) => r.status === 'active').length,
    paused: rules.filter((r) => r.status === 'paused').length,
    draft: rules.filter((r) => r.status === 'draft').length,
  };

  const filtered =
    filter === 'all' ? rules : rules.filter((r) => r.status === filter);

  if (rules.length === 0) {
    return <EmptyAutomations onNew={onNew} />;
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <FilterBar filter={filter} onChange={onFilterChange} counts={counts} />
        <span className="text-xs text-muted-foreground">
          {filtered.length} rule{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Rule cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
          <p className="text-sm text-muted-foreground">No {filter} rules.</p>
          <Button variant="ghost" size="sm" onClick={onNew} className="mt-3 rounded-xl text-xs gap-1.5">
            <Zap className="size-3" />
            Create a rule
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-in">
          {filtered.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={onEdit}
              onToggle={onToggle}
              onDelete={onDelete}
              onRunNow={onRunNow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export FilterStatus so AutomationsPage can use it
export type { FilterStatus };
