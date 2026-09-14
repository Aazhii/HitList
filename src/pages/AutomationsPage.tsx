import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Zap,
  Plus,
  Activity,
  PauseCircle,
  FileEdit,
  Clock,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  SkipForward,
  History,
  Loader2,
  ServerCrash,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAutomations } from '@/hooks/useAutomations';
import { useAutomationRuns } from '@/hooks/useAutomationRuns';
import { AutomationList } from '@/components/automations/AutomationList';
import { AutomationRuleForm } from '@/components/automations/AutomationRuleForm';
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
import type { AutomationRule, AutomationRuleFormValues, AutomationStatus } from '@/types/automation';
import type { Todo } from '@/types/todo';
import type { ApiAutomationRun } from '@/api/automationRunsApi';

// ── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: number | string;
  accent?: string;
}

function StatCard({ icon: Icon, label, value, accent }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 transition-shadow duration-200 hover:shadow-sm">
      <div
        className={cn(
          'flex size-9 flex-shrink-0 items-center justify-center rounded-xl border',
          accent ?? 'bg-muted/50 border-border/50 text-muted-foreground'
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-foreground tabular-nums leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground leading-tight mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── AutomationsPage ───────────────────────────────────────────────────────────

interface AutomationsPageProps {
  todos: Todo[];
}

type FilterStatus = 'all' | AutomationStatus;

// ── Run status helpers ────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'SUCCESS') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3" /> success
      </span>
    );
  }
  if (status === 'SKIPPED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <SkipForward className="size-3" /> skipped
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
      <XCircle className="size-3" /> error
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

// ── Recent Executions panel ───────────────────────────────────────────────────

interface RecentRunsPanelProps {
  runs: ApiAutomationRun[];
  isLoading: boolean;
  error: string | null;
  lastChecked: Date | null;
  onRefresh: () => void;
}

function RecentRunsPanel({ runs, isLoading, error, lastChecked, onRefresh }: RecentRunsPanelProps) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Recent Executions</h3>
          {runs.length > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
              {runs.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastChecked && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Updated {formatRelative(lastChecked.getTime())}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-7 w-7 p-0 rounded-lg"
            aria-label="Refresh runs"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-5 py-3 text-sm text-destructive bg-destructive/5">
          <ServerCrash className="size-4 flex-shrink-0" />
          <span>Backend unavailable — {error}</span>
        </div>
      )}

      {!error && runs.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <History className="size-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No executions yet</p>
          <p className="text-xs text-muted-foreground/70">
            Activate a rule and click <strong>Run Now</strong> or wait for the scheduler.
          </p>
        </div>
      )}

      {isLoading && runs.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {runs.length > 0 && (
        <ul className="divide-y divide-border/40">
          {runs.map((run) => (
            <li key={run.id} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/30 transition-colors duration-150">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground truncate">{run.ruleName}</span>
                  <Badge
                    variant="outline"
                    className="text-xs px-1.5 py-0 h-4 flex-shrink-0 capitalize"
                  >
                    {run.source}
                  </Badge>
                </div>
                {run.detail && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{run.detail}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <RunStatusBadge status={run.status} />
                <span className="text-xs text-muted-foreground">{formatRelative(run.triggeredAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── AutomationsPage ───────────────────────────────────────────────────────────

export function AutomationsPage({ todos }: AutomationsPageProps) {
  const todoStubs = useMemo(
    () => todos.map((t) => ({ id: t.id, text: t.text })),
    [todos]
  );

  const { rules, online: rulesOnline, error: rulesError, addRule, updateRule, toggleStatus, deleteRule } =
    useAutomations(todoStubs);

  const { runs, lastChecked, isLoading: runsLoading, error: runsError, triggerRule, refresh: refreshRuns } =
    useAutomationRuns();

  // Run Now handler
  const handleRunNow = useCallback(async (ruleId: string) => {
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
  }, [rules, triggerRule]);

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);

  // Filter
  const [filter, setFilter] = useState<FilterStatus>('all');

  // ── Stats ──────────────────────────────────────────────────────────────────

  const activeCount = rules.filter((r) => r.status === 'active').length;
  const pausedCount = rules.filter((r) => r.status === 'paused').length;
  const draftCount  = rules.filter((r) => r.status === 'draft').length;

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
    if (diff <= 0) return 'now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }, [rules, now]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleNew = () => {
    setEditingRule(null);
    setFormOpen(true);
  };

  const handleEdit = (rule: AutomationRule) => {
    setEditingRule(rule);
    setFormOpen(true);
  };

  const handleFormSubmit = async (values: AutomationRuleFormValues) => {
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
    const rule = rules.find((r) => r.id === id);
    if (rule) setDeleteTarget(rule);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    setDeleteTarget(null);
    await deleteRule(deleteTarget.id);
    toast('Rule deleted', { description: name, duration: 2000 });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-4 md:px-6 py-6 space-y-6 max-w-6xl mx-auto">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10">
                <Zap className="size-4 text-primary" />
              </span>
              Automations
            </h2>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Create rules to automatically remind you about tasks, send digests, and escalate overdue items.
            </p>
          </div>
          <Button
            onClick={handleNew}
            className="rounded-xl gap-2 px-4 flex-shrink-0"
          >
            <Plus className="size-3.5" />
            New rule
          </Button>
        </div>

        {/* Rules cannot fire while the server is unreachable, and a page that
            stays silent about that is how this feature came to look like it
            worked. Say so plainly. */}
        {!rulesOnline && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Working offline — rules are saved on this device and will not fire until
            the server is reachable again.
          </div>
        )}

        {rulesError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            {rulesError}
          </div>
        )}

        {/* Stats bar */}
        {rules.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in">
            <StatCard
              icon={Activity}
              label="Active rules"
              value={activeCount}
              accent="bg-emerald-500/8 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
            />
            <StatCard
              icon={PauseCircle}
              label="Paused"
              value={pausedCount}
              accent="bg-amber-500/8 border-amber-500/20 text-amber-600 dark:text-amber-400"
            />
            <StatCard
              icon={FileEdit}
              label="Drafts"
              value={draftCount}
              accent="bg-muted/50 border-border/50 text-muted-foreground"
            />
            <StatCard
              icon={Clock}
              label="Next trigger"
              value={nextTrigger ?? '—'}
              accent="bg-primary/8 border-primary/20 text-primary"
            />
          </div>
        )}

        {/* Rule list */}
        <AutomationList
          rules={rules}
          filter={filter}
          onFilterChange={setFilter}
          onNew={handleNew}
          onEdit={handleEdit}
          onToggle={handleToggle}
          onDelete={handleDeleteRequest}
          onRunNow={handleRunNow}
        />

        {/* Recent Executions panel */}
        <RecentRunsPanel
          runs={runs}
          isLoading={runsLoading}
          error={runsError}
          lastChecked={lastChecked}
          onRefresh={refreshRuns}
        />
      </div>

      {/* Create / edit form */}
      <AutomationRuleForm
        open={formOpen}
        editingRule={editingRule}
        todos={todoStubs}
        onOpenChange={setFormOpen}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
