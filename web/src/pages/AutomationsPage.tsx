import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  History,
  Loader2,
  Plus,
  RefreshCw,
  ServerCrash,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAutomations } from '@/hooks/useAutomations';
import { useAutomationRuns } from '@/hooks/useAutomationRuns';
import { AUTOMATIONS_UNAVAILABLE_REASON } from '@/lib/api';
import {
  AutomationFilters,
  AutomationList,
  countRulesByStatus,
  type FilterStatus,
} from '@/components/automations/AutomationList';
import { AutomationRuleForm } from '@/components/automations/AutomationRuleForm';
import { ViewLayout } from '@/components/shell/ViewLayout';
import { TopBar, topBarPrimary } from '@/components/shell/TopBar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { AutomationRule, AutomationRuleFormValues } from '@/types/automation';
import type { Todo } from '@/types/todo';
import type { ApiAutomationRun } from '@/api/automationRunsApi';

interface AutomationsPageProps {
  todos: Todo[];
  userId?: string | null;
  /** A task sent here from its detail panel; opens the rule form for it. */
  escalationTaskId?: string | null;
  onEscalationHandled?: () => void;
}

/** Rules that hang off a task's due date, which is what "escalation" means here. */
function isTaskDriven(rule: AutomationRule): boolean {
  return rule.triggerType === 'due-date' || rule.triggerType === 'overdue';
}

// ── Run status helpers ────────────────────────────────────────────────────────

const RUN_CHIP = 'inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[12px] font-semibold leading-none';

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'SUCCESS') {
    return (
      <span className={cn(RUN_CHIP, 'bg-a-sage-tint text-a-sage-ink')}>
        <CheckCircle2 className="size-3" strokeWidth={2.75} aria-hidden /> success
      </span>
    );
  }
  if (status === 'SKIPPED') {
    return (
      <span className={cn(RUN_CHIP, 'bg-q-delegate-bg text-q-delegate')}>
        <SkipForward className="size-3" strokeWidth={2.75} aria-hidden /> skipped
      </span>
    );
  }
  return (
    <span className={cn(RUN_CHIP, 'bg-q-do-bg text-q-do')}>
      <XCircle className="size-3" strokeWidth={2.75} aria-hidden /> error
    </span>
  );
}

function formatRelative(at: number): string {
  const diff = Date.now() - at;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Recent runs ───────────────────────────────────────────────────────────────

interface RecentRunsPanelProps {
  runs: ApiAutomationRun[];
  isLoading: boolean;
  error: string | null;
  lastChecked: Date | null;
  onRefresh: () => void;
}

function RecentRunsPanel({ runs, isLoading, error, lastChecked, onRefresh }: RecentRunsPanelProps) {
  return (
    <section aria-labelledby="recent-runs-heading" className="overflow-hidden rounded-[16px] border border-a-line bg-a-bg">
      <header className="flex items-center justify-between gap-3 border-b border-a-line-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 id="recent-runs-heading" className="font-display text-[19px] leading-tight text-a-ink">Recent runs</h2>
          {runs.length > 0 && <span className="text-[13px] tabular-nums text-a-faint">{runs.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          {lastChecked && (
            <span className="hidden text-[12px] text-a-faint sm:block">
              Updated {formatRelative(lastChecked.getTime())}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh runs"
            className="flex size-7 items-center justify-center rounded-[9px] text-a-faint transition-colors duration-150 hover:bg-a-row-hover hover:text-a-ink disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 bg-q-do-bg px-4 py-3 text-[13.5px] text-q-do" role="alert">
          <ServerCrash className="size-4 flex-shrink-0" strokeWidth={2.5} aria-hidden />
          <span>Backend unavailable — {error}</span>
        </div>
      )}

      {!error && runs.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <History className="size-7 text-a-faint/50" strokeWidth={2.25} aria-hidden />
          <p className="text-[14.5px] text-a-muted">No runs yet</p>
          <p className="text-[12.5px] text-a-faint">
            Activate a rule and press <strong className="font-semibold">Run now</strong>, or wait for the scheduler.
          </p>
        </div>
      )}

      {isLoading && runs.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-a-faint">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <span className="text-[13.5px]">Loading…</span>
        </div>
      )}

      {runs.length > 0 && (
        <ul>
          {runs.map((run) => (
            <li
              key={run.id}
              className="flex items-start gap-3 border-b border-a-line-soft px-4 py-3 transition-colors duration-150 last:border-0 hover:bg-a-row-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[14.5px] font-medium text-a-ink">{run.ruleName}</span>
                  <span className="flex-shrink-0 rounded-full px-2 py-[2px] text-[11.5px] capitalize text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]">
                    {run.source}
                  </span>
                </div>
                {run.detail && <p className="mt-0.5 truncate text-[12.5px] text-a-faint">{run.detail}</p>}
              </div>
              <div className="flex flex-shrink-0 flex-col items-end gap-1">
                <RunStatusBadge status={run.status} />
                <span className="text-[12px] text-a-faint">{formatRelative(run.triggeredAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── AutomationsPage ───────────────────────────────────────────────────────────

export function AutomationsPage({ todos, userId, escalationTaskId, onEscalationHandled }: AutomationsPageProps) {
  const todoStubs = useMemo(
    () => todos.map((t) => ({ id: t.id, text: t.text })),
    [todos]
  );

  const { rules, loading: rulesLoading, online: rulesOnline, error: rulesError, addRule, updateRule, toggleStatus, deleteRule } =
    useAutomations(todoStubs, userId);

  const { runs, lastChecked, isLoading: runsLoading, error: runsError, triggerRule, refresh: refreshRuns } =
    useAutomationRuns();

  const automationsPaused = true;

  // Run Now handler
  const handleRunNow = useCallback(async (ruleId: string) => {
    if (automationsPaused) {
      toast.error(AUTOMATIONS_UNAVAILABLE_REASON, { duration: 3000 });
      return;
    }
    const rule = rules.find((r) => r.id === ruleId);
    const run = await triggerRule(ruleId);
    if (run) {
      toast.success('Rule triggered', {
        description: rule?.name ?? ruleId,
        duration: 2500,
      });
    } else {
      toast.error('Trigger failed — backend may be unavailable', { duration: 3000 });
    }
  }, [rules, triggerRule, automationsPaused]);

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  /** A task whose rule form should open, handed over from the task panel. */
  const [prefillTaskId, setPrefillTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!escalationTaskId) return;
    if (automationsPaused) {
      onEscalationHandled?.();
      return;
    }
    // Its existing rule if it has one, so "Add escalation" edits rather than
    // silently creating a second rule beside the first.
    const existing = rules.find((r) => r.taskId === escalationTaskId && isTaskDriven(r));
    setEditingRule(existing ?? null);
    setPrefillTaskId(existing ? null : escalationTaskId);
    setFormOpen(true);
    onEscalationHandled?.();
  }, [automationsPaused, escalationTaskId, rules, onEscalationHandled]);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);

  // Filter
  const [filter, setFilter] = useState<FilterStatus>('all');

  // ── Stats ──────────────────────────────────────────────────────────────────

  const counts = useMemo(() => countRulesByStatus(rules), [rules]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nextTrigger = useMemo(() => {
    const upcoming = rules
      .filter((r) => r.status === 'active' && r.nextTriggerAt)
      .sort((a, b) => (a.nextTriggerAt ?? 0) - (b.nextTriggerAt ?? 0));
    if (!upcoming.length) return null;
    const diff = (upcoming[0].nextTriggerAt ?? 0) - now;
    const name = upcoming[0].name;
    if (diff <= 0) return { when: 'now', name };
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return { when: `in ${mins}m`, name };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return { when: `in ${hrs}h`, name };
    return { when: `in ${Math.floor(hrs / 24)}d`, name };
  }, [rules, now]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleNew = () => {
    if (automationsPaused) {
      toast.error(AUTOMATIONS_UNAVAILABLE_REASON, { duration: 3000 });
      return;
    }
    setEditingRule(null);
    setFormOpen(true);
  };

  const handleEdit = (rule: AutomationRule) => {
    if (automationsPaused) {
      toast.error(AUTOMATIONS_UNAVAILABLE_REASON, { duration: 3000 });
      return;
    }
    setEditingRule(rule);
    setFormOpen(true);
  };

  const handleFormSubmit = async (values: AutomationRuleFormValues) => {
    if (automationsPaused) {
      toast.error(AUTOMATIONS_UNAVAILABLE_REASON, { duration: 3000 });
      return;
    }
    // Await before reporting. These calls used to be fire-and-forget with an
    // unconditional success toast, which told the user their rule was saved
    // whether or not it was.
    if (editingRule) {
      await updateRule(editingRule.id, values);
      toast.success('Rule updated', { duration: 2000 });
    } else {
      const created = await addRule(values);
      if (!created) {
        toast.error('Could not save the rule', { duration: 3000 });
        return;
      }
      toast.success('Automation rule created', {
        // A rule saved offline is a draft: firing happens server-side, and
        // saying otherwise repeats the promise this page used to make.
        description: rulesOnline ? values.name : `${values.name} — saved offline, will not fire yet`,
        duration: 2500,
      });
    }
  };

  const handleToggle = async (id: string) => {
    if (automationsPaused) {
      toast.error(AUTOMATIONS_UNAVAILABLE_REASON, { duration: 3000 });
      return;
    }
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;
    await toggleStatus(id);
    const next = rule.status === 'active' ? 'paused' : 'active';
    toast(next === 'active' ? 'Rule activated' : 'Rule paused', {
      description: rule.name,
      duration: 2000,
    });
  };

  const handleDeleteRequest = (id: string) => {
    if (automationsPaused) {
      toast.error(AUTOMATIONS_UNAVAILABLE_REASON, { duration: 3000 });
      return;
    }
    const rule = rules.find((r) => r.id === id);
    if (rule) setDeleteTarget(rule);
  };

  const handleDeleteConfirm = async () => {
    if (automationsPaused) {
      setDeleteTarget(null);
      toast.error(AUTOMATIONS_UNAVAILABLE_REASON, { duration: 3000 });
      return;
    }
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    setDeleteTarget(null);
    await deleteRule(deleteTarget.id);
    toast('Rule deleted', { description: name, duration: 2000 });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <ViewLayout
        contextLabel="Rule filters"
        context={<AutomationFilters filter={filter} counts={counts} onChange={setFilter} />}
        contextFoot={
          // The "Next trigger" stat card, now at the foot of the column.
          <div className="px-3 pt-3 pb-1">
            <p className="text-[13px] text-a-muted">Next trigger</p>
            <p className="mt-0.5 font-display text-[19px] leading-tight text-a-ink">
              {nextTrigger ? nextTrigger.when : '—'}
            </p>
            <p className="mt-0.5 truncate text-[12.5px] text-a-faint">
              {nextTrigger ? nextTrigger.name : 'No active rule is scheduled'}
            </p>
          </div>
        }
        topBar={
          <TopBar
            title="Automations"
            subtitle={`${counts.all} rule${counts.all !== 1 ? 's' : ''} · ${counts.active} active`}
            actions={
              <button
                type="button"
                onClick={handleNew}
                className={topBarPrimary}
                aria-label="New rule"
                disabled={automationsPaused}
              >
                <Plus className="size-[15px]" strokeWidth={2.75} aria-hidden />
                <span className="hidden sm:inline">New rule</span>
              </button>
            }
          />
        }
      >
        <div className="mx-auto max-w-[880px] space-y-7 px-4 py-[22px] md:px-[26px]">
          {/* Rules cannot fire while the server is unreachable, and a page that
              stays silent about that is how this feature came to look like it
              worked. Say so plainly. */}
          {!rulesOnline && (
            <div className="rounded-[14px] bg-q-delegate-bg px-4 py-3 text-[13.5px] text-q-delegate" role="status">
              Working offline — rules are saved on this device and will not fire until
              the server is reachable again.
            </div>
          )}

          {automationsPaused && (
            <div className="rounded-[14px] bg-q-delegate-bg px-4 py-3 text-[13.5px] text-q-delegate" role="status">
              <strong>Automations are unavailable.</strong> Rules and reminders cannot run in the
              PostgreSQL-only migration, so creating, editing, and triggering rules is disabled.
            </div>
          )}

          {rulesError && (
            <div className="rounded-[14px] bg-q-do-bg px-4 py-3 text-[13.5px] text-q-do" role="alert">
              {rulesError}
            </div>
          )}

          <AutomationList
            rules={rules}
            loading={rulesLoading}
            filter={filter}
            onNew={handleNew}
            onEdit={handleEdit}
            onToggle={handleToggle}
            onDelete={handleDeleteRequest}
            onRunNow={handleRunNow}
          />

          <RecentRunsPanel
            runs={runs}
            isLoading={runsLoading}
            error={runsError}
            lastChecked={lastChecked}
            onRefresh={refreshRuns}
          />
        </div>
      </ViewLayout>

      {/* Create / edit form */}
      <AutomationRuleForm
        open={formOpen}
        editingRule={editingRule}
        prefillTaskId={prefillTaskId}
        todos={todoStubs}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setPrefillTaskId(null); }}
        onSubmit={handleFormSubmit}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This automation rule will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-a-bg hover:bg-destructive/90"
            >
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
