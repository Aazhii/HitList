import { memo } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Calendar,
  Clock,
  ExternalLink,
  Loader2,
  Pause,
  Pencil,
  Play,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { summarise } from '@/lib/reminderSteps';
import { describeSpec } from '@/lib/automationSpec';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
  'custom':        Zap,
};

// ── Tones ─────────────────────────────────────────────────────────────────────
// The organic palette's inks, rather than the Tailwind emerald / amber / rose
// the old cards used. Each ink clears 4.5:1 on its own tint.

const CHIP = 'inline-flex items-center gap-1 rounded-[3px] px-2.5 py-[3px] text-[12px] leading-none whitespace-nowrap';

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
  // A rule fires at each of its steps, so the summary lists them rather than
  // naming one offset: "1 hour before due, then 5 minutes before due".
  if (rule.offsetMinutes?.length) return summarise(rule.offsetMinutes);
  if (rule.triggerType === 'due-date' && rule.reminderOffset) {
    const { value, unit } = rule.reminderOffset;
    return `${value} ${unit} before due`;
  }
  if (rule.triggerType === 'overdue') return 'when it falls due';
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
      <ContextSectionHeader label="Rule filters" />
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
                <span className={cn('min-w-0 flex-1 truncate text-[14px]', active ? 'font-semibold text-a-ink' : 'text-a-muted')}>
                  {opt.label}
                </span>
                <span className="font-mono text-[11px] text-a-faint">
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
      <div className="mb-5 flex size-16 items-center justify-center rounded-[12px] bg-a-accent-tint">
        <Zap className="size-7 text-a-accent-700" strokeWidth={1.75} />
      </div>
      <h3 className="mb-2 font-display text-[20px] text-a-ink">No automation rules yet</h3>
      <p className="mb-6 max-w-xs text-[14px] leading-relaxed text-a-muted">
        Create rules to automatically remind you about tasks, send daily digests, or escalate overdue items.
      </p>
      <Button onClick={onNew} className="gap-2 rounded-[6px] px-5">
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

const ROW_ACTION = 'flex size-7 items-center justify-center rounded-[4px] text-a-faint transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink';


/** The DS Badge, with a dot: 999px, 11px / 600 (showcase 893). */
const STATUS_BADGE: Record<AutomationStatus, { pill: string; label: string }> = {
  active: { pill: 'bg-a-green-tint text-a-green-ink', label: 'Active' },
  paused: { pill: 'bg-a-line-soft text-a-muted', label: 'Paused' },
  draft: { pill: 'bg-a-amber-tint text-a-amber', label: 'Draft' },
};

const RuleCard = memo(function RuleCard({
  rule,
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
}: RuleCardProps) {
  const TriggerIcon = TRIGGER_ICONS[rule.triggerType];
  const isActive = rule.status === 'active';
  const badge = STATUS_BADGE[rule.status];
  // "A task's due date: 1 hour before it is due · Only if Category is "Work" · Then: Message me on Cliq", task first when linked.
  const parts = rule.spec ? describeSpec(rule.spec) : null;
  const channels = [rule.notifyInApp && 'In-app', rule.notifyBrowser && 'Browser'].filter(Boolean).join(', ') || 'No notifications';
  const description = parts
    ? [rule.taskTitle, parts.when, parts.only.length ? `Only if ${parts.only.join(' and ')}` : '', `Then: ${parts.then.join(', ')}`].filter(Boolean).join(' · ')
    : [rule.taskTitle, rule.description ?? formatOffset(rule), channels, `${URGENCY_LABELS[rule.urgency]} urgency`].filter(Boolean).join(' · ');
  const next = rule.status === 'paused' ? 'Paused'
    : rule.status === 'draft' ? 'Not scheduled'
    : rule.nextTriggerAt ? `Next: ${formatNextTrigger(rule.nextTriggerAt)}` : 'Waiting for its moment';

  return (
    <article className="group flex items-center gap-4 rounded-[6px] border border-a-line bg-a-surface px-4 py-3.5">
      <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-[8px] bg-a-violet-tint text-a-violet-ink" aria-hidden>
        <TriggerIcon className="size-[18px]" strokeWidth={1.75} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[14px] font-semibold text-a-ink">{rule.name}</h3>
          {/* design-check-ignore: pill — the DS Badge is a pill. */}
          <span className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-transparent px-2 py-[3px] text-[11px] leading-none font-semibold', badge.pill)}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {badge.label}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-normal text-a-faint">{description}</p>
        {rule.error && (
          <p role="alert" className="mt-0.5 flex items-center gap-1 text-[12px] text-a-attention">
            <AlertTriangle className="size-3 flex-shrink-0" strokeWidth={1.75} aria-hidden /> {rule.error}
          </p>
        )}
        {rule.lastTriggeredAt && (
          <p className="mt-0.5 text-[12px] text-a-faint">Last triggered {formatRelativeTime(rule.lastTriggeredAt)}</p>
        )}
      </div>

      {/* Not in the prototype's row; shown on hover so a rule can be opened or removed. */}
      <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={() => onEdit(rule)} aria-label="Edit rule" className={ROW_ACTION}>
          <Pencil className="size-4" strokeWidth={1.75} />
        </button>
        <button type="button" onClick={() => onDelete(rule.id)} aria-label="Delete rule" className={cn(ROW_ACTION, 'hover:text-q-do')}>
          <Trash2 className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      <span className="min-w-[110px] flex-shrink-0 text-right text-[12px] text-a-faint">{next}</span>
      <button
        type="button"
        onClick={() => onRunNow?.(rule.id)}
        disabled={!onRunNow || !isActive}
        aria-label="Run rule now"
        className="h-7 flex-shrink-0 rounded-[3px] border border-a-line-strong bg-a-surface px-3 text-[11px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50"
      >
        Run now
      </button>
      <Switch
        size="sm"
        checked={isActive}
        onCheckedChange={() => onToggle(rule.id)}
        aria-label={isActive ? 'Pause rule' : 'Activate rule'}
      />
    </article>
  );
});

// ── AutomationList (exported) ─────────────────────────────────────────────────

interface AutomationListProps {
  rules: AutomationRule[];
  /** True while the initial fetch is in flight — an empty list doesn't yet mean "no rules". */
  loading?: boolean;
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
  loading,
  filter,
  onNew,
  onEdit,
  onToggle,
  onDelete,
  onRunNow,
}: AutomationListProps) {
  if (rules.length === 0 && loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-a-faint">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span className="text-[14px]">Loading…</span>
      </div>
    );
  }
  if (rules.length === 0) {
    return <EmptyAutomations onNew={onNew} />;
  }

  const filtered = filter === 'all' ? rules : rules.filter((r) => r.status === filter);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
        <p className="text-[14px] text-a-muted">No {filter} rules.</p>
        <Button variant="ghost" size="sm" onClick={onNew} className="mt-3 gap-1.5 rounded-[6px] text-xs">
          <Zap className="size-3" />
          Create a rule
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 animate-fade-in">
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
