import { memo } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Calendar,
  Clock,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { AutomationRule, TriggerType, UrgencyLevel, AutomationStatus } from '@/types/automation';
import { TRIGGER_TYPE_LABELS, URGENCY_LABELS } from '@/types/automation';
import {
  ContextSectionHeader,
  contextRowClass,
  useViewLayout,
} from '@/components/shell/ViewLayout';

// ── Trigger icon map ──────────────────────────────────────────────────────────

const TRIGGER_ICONS: Record<TriggerType, React.ElementType> = {
  'due-date':      Clock,
  'overdue':       AlertTriangle,
  'recurring':     Repeat,
  'status-change': Zap,
  'daily-digest':  BookOpen,
};

// ── Tones ─────────────────────────────────────────────────────────────────────
// The organic palette's inks, rather than the Tailwind emerald / amber / rose
// the old cards used. Each ink clears 4.5:1 on its own tint.

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[12px] leading-none whitespace-nowrap';

const STATUS_CHIP: Record<AutomationStatus, string> = {
  active: 'bg-a-sage-tint text-a-sage-ink font-semibold',
  paused: 'bg-q-delegate-bg text-q-delegate font-semibold',
  draft:  'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]',
};

const STATUS_DOT: Record<AutomationStatus, string> = {
  active: 'bg-a-sage',
  paused: 'bg-q-delegate',
  draft:  'bg-a-faint/50',
};

const URGENCY_CHIP: Record<UrgencyLevel, string> = {
  low:      'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]',
  medium:   'bg-q-schedule-bg text-q-schedule',
  high:     'bg-q-delegate-bg text-q-delegate',
  critical: 'bg-q-do-bg text-q-do font-semibold',
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

// ── Filters, for the shell's context column ──────────────────────────────────

type FilterStatus = 'all' | AutomationStatus;

const FILTER_OPTIONS: ReadonlyArray<{ id: FilterStatus; label: string }> = [
  { id: 'all', label: 'All rules' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'draft', label: 'Drafts' },
];

export function countRulesByStatus(rules: AutomationRule[]): Record<FilterStatus, number> {
  return {
    all: rules.length,
    active: rules.filter((r) => r.status === 'active').length,
    paused: rules.filter((r) => r.status === 'paused').length,
    draft: rules.filter((r) => r.status === 'draft').length,
  };
}

/**
 * All / Active / Paused / Drafts, as pills in the context column.
 *
 * This was a segmented bar above the rule cards; the counts it carried also
 * replace the four stat cards that used to head the page.
 */
export function AutomationFilters({
  filter,
  counts,
  onChange,
}: {
  filter: FilterStatus;
  counts: Record<FilterStatus, number>;
  onChange: (f: FilterStatus) => void;
}) {
  const { closeContext } = useViewLayout();

  return (
    <>
      <ContextSectionHeader label="Rules" />
      <ul className="space-y-0.5">
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => { onChange(opt.id); closeContext(); }}
                aria-current={active ? 'true' : undefined}
                className={contextRowClass(active)}
              >
                <span
                  className={cn(
                    'size-2 flex-shrink-0 rounded-full',
                    opt.id === 'all' ? 'bg-a-accent' : STATUS_DOT[opt.id],
                  )}
                  aria-hidden
                />
                <span className={cn('min-w-0 flex-1 truncate text-[14.5px]', active ? 'font-semibold text-a-ink' : 'text-a-muted')}>
                  {opt.label}
                </span>
                <span className={cn('text-[12.5px] tabular-nums', active ? 'font-bold text-a-accent-700' : 'text-a-faint')}>
                  {counts[opt.id]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyAutomations({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center animate-fade-in">
      <div className="mb-5 flex size-16 items-center justify-center rounded-[20px] bg-a-accent-tint">
        <Zap className="size-7 text-a-accent-700" strokeWidth={2.25} />
      </div>
      <h3 className="mb-2 font-display text-[22px] text-a-ink">No automation rules yet</h3>
      <p className="mb-6 max-w-xs text-[14.5px] leading-relaxed text-a-muted">
        Create rules to automatically remind you about tasks, send daily digests, or escalate overdue items.
      </p>
      <Button onClick={onNew} className="gap-2 rounded-full px-5">
        <Zap className="size-3.5" />
        Create your first rule
      </Button>
    </div>
  );
}

// ── Rule row ──────────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: AutomationRule;
  onEdit: (rule: AutomationRule) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRunNow?: (id: string) => void;
}

const ROW_ACTION = cn(
  'flex size-7 items-center justify-center rounded-[9px] text-a-faint transition-[opacity,background-color,color] duration-150',
  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
  'hover:bg-[color-mix(in_srgb,var(--a-ink)_9%,transparent)] hover:text-a-ink',
);

const FOOT_BUTTON =
  'flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-150';

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
    <article
      className={cn(
        'group relative rounded-[16px] bg-a-bg px-4 pt-3.5 pb-2.5 transition-[box-shadow,opacity] duration-200',
        'shadow-[inset_0_0_0_1px_var(--a-line)] hover:shadow-[inset_0_0_0_1px_var(--a-line),var(--a-shadow-sm)]',
        !isActive && 'opacity-85 hover:opacity-100',
      )}
    >
      <div className="flex items-start gap-3.5">
        <div
          className={cn(
            'flex size-9 flex-shrink-0 items-center justify-center rounded-[12px] transition-colors duration-200',
            isActive ? 'bg-a-accent-tint text-a-accent-700' : 'bg-a-surface text-a-faint',
          )}
          aria-hidden
        >
          <TriggerIcon className="size-4" strokeWidth={2.5} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15.5px] font-semibold leading-tight text-a-ink">{rule.name}</h3>
            <span className={cn(CHIP, STATUS_CHIP[rule.status], 'capitalize')}>{rule.status}</span>
            <span className={cn(CHIP, URGENCY_CHIP[rule.urgency])}>{URGENCY_LABELS[rule.urgency]}</span>
          </div>

          {rule.description && (
            <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-a-muted">{rule.description}</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-a-faint">
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5 flex-shrink-0" strokeWidth={2.5} aria-hidden />
              {formatOffset(rule)}
            </span>
            {rule.taskTitle && (
              <span className="flex min-w-0 items-center gap-1.5">
                <ExternalLink className="size-3.5 flex-shrink-0" strokeWidth={2.5} aria-hidden />
                <span className="max-w-[200px] truncate" title={rule.taskTitle}>{rule.taskTitle}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Bell className="size-3.5 flex-shrink-0" strokeWidth={2.5} aria-hidden />
              {[rule.notifyInApp && 'In-app', rule.notifyBrowser && 'Browser'].filter(Boolean).join(' · ') || 'No notifications'}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            {rule.lastTriggeredAt && (
              <span className="text-a-faint">Last triggered {formatRelativeTime(rule.lastTriggeredAt)}</span>
            )}
            {rule.nextTriggerAt && isActive && (
              <span className="font-semibold text-a-sage-ink">Next {formatNextTrigger(rule.nextTriggerAt)}</span>
            )}
            {!rule.lastTriggeredAt && !rule.nextTriggerAt && (
              <span className="text-a-faint/80">Never triggered</span>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => onEdit(rule)} aria-label="Edit rule" className={ROW_ACTION}>
            <Pencil className="size-3.5" strokeWidth={2.5} />
          </button>
          <button type="button" onClick={() => onDelete(rule.id)} aria-label="Delete rule" className={cn(ROW_ACTION, 'hover:text-q-do')}>
            <Trash2 className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-a-line-soft pt-2">
        <span className="text-[12.5px] text-a-faint">
          {isActive ? 'Rule is active' : isPaused ? 'Rule is paused' : 'Draft — not active'}
        </span>
        <div className="flex items-center gap-1">
          {onRunNow && isActive && (
            <button
              type="button"
              onClick={() => onRunNow(rule.id)}
              aria-label="Run rule now"
              className={cn(FOOT_BUTTON, 'text-a-accent-700 hover:bg-a-accent-tint')}
            >
              <Play className="size-3.5" strokeWidth={2.5} /> Run now
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggle(rule.id)}
            aria-label={isActive ? 'Pause rule' : 'Activate rule'}
            className={cn(
              FOOT_BUTTON,
              isActive ? 'text-q-delegate hover:bg-q-delegate-bg' : 'text-a-sage-ink hover:bg-a-sage-tint',
            )}
          >
            {isActive
              ? <><Pause className="size-3.5" strokeWidth={2.5} /> Pause</>
              : <><Play className="size-3.5" strokeWidth={2.5} /> Activate</>}
          </button>
        </div>
      </div>
    </article>
  );
});

// ── AutomationList (exported) ─────────────────────────────────────────────────

interface AutomationListProps {
  rules: AutomationRule[];
  filter: FilterStatus;
  onNew: () => void;
  onEdit: (rule: AutomationRule) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRunNow?: (id: string) => void;
}

/**
 * The rules, filtered. The filter itself lives in the context column — see
 * AutomationFilters.
 */
export function AutomationList({
  rules,
  filter,
  onNew,
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
}: AutomationListProps) {
  if (rules.length === 0) {
    return <EmptyAutomations onNew={onNew} />;
  }

  const filtered = filter === 'all' ? rules : rules.filter((r) => r.status === filter);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
        <p className="text-[14.5px] text-a-muted">No {filter} rules.</p>
        <Button variant="ghost" size="sm" onClick={onNew} className="mt-3 gap-1.5 rounded-full text-xs">
          <Zap className="size-3" />
          Create a rule
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 animate-fade-in">
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
  );
}

// Re-export FilterStatus so AutomationsPage can use it
export type { FilterStatus };
