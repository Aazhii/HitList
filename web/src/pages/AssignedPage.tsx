/**
 * Assigned to me: every task in a shared workspace on this computer that someone gave you (or you gave yourself), across all
 * your shared workspaces. Opening one switches to its workspace's Tasks view.
 */
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { TopBar } from '@/components/shell/TopBar';
import { ViewLayoutContext } from '@/components/shell/ViewLayout';
import { EmptyState, ILL } from '@/components/EmptyState';
import { DUE_TONE_CLASS, dueTone, getDueInfo } from '@/lib/dueInfo';
import { memberLabel } from '@/lib/workspaceMessage';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import type { ApiTask } from '@/lib/api';

export interface AssignedTask extends ApiTask { workspaceId: string; workspaceName: string }

const STATUS_LABEL: Record<string, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };

export function AssignedPage({ onOpen, onOpenSidebar }: { onOpen: (task: AssignedTask) => void; onOpenSidebar?: () => void }) {
  const ws = useWorkspaces();
  const [tasks, setTasks] = useState<AssignedTask[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/assigned');
      setTasks(res.ok ? ((await res.json()) as AssignedTask[]) : []);
    } catch {
      setTasks((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    // Another member just changed something, or gave you a task: read the list again.
    window.addEventListener('hitlist:workspace-data-changed', load);
    return () => window.removeEventListener('hitlist:workspace-data-changed', load);
  }, [load]);

  const open = (tasks ?? []).filter((t) => t.status !== 'DONE');
  const done = (tasks ?? []).filter((t) => t.status === 'DONE');
  const nameOf = (id: string | null | undefined) => {
    if (!id) return null;
    for (const w of ws.workspaces) { const m = w.members.find((x) => x.userId === id); if (m) return memberLabel(m); }
    return null;
  };

  const row = (t: AssignedTask) => {
    const due = t.status === 'DONE' ? null : getDueInfo(t.dueDate ?? undefined, t.dueTime ?? undefined);
    const by = nameOf(t.assignedBy);
    return (
      <li key={`${t.workspaceId}:${t.id}`}>
        <button
          type="button"
          onClick={() => onOpen(t)}
          className="flex w-full flex-col gap-1 rounded-[6px] border border-a-line bg-a-surface px-4 py-3 text-left transition-shadow duration-[120ms] hover:shadow-[var(--a-shadow-md)]"
        >
          <span className={cn('text-[14px] font-medium [overflow-wrap:anywhere]', t.status === 'DONE' ? 'text-a-faint line-through' : 'text-a-ink')}>{t.title}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-a-muted">
            <span>{t.workspaceName}</span>
            <span>{STATUS_LABEL[t.status] ?? t.status}</span>
            {due && <span className={DUE_TONE_CLASS[dueTone(due)]}>{due.label}</span>}
            {by && <span>from {by}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <ViewLayoutContext.Provider value={{ openContext: () => onOpenSidebar?.(), closeContext: () => {}, toggleCollapsed: () => {}, collapsible: false, collapsed: false }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar title="Assigned to me" subtitle="Tasks other people gave you, in every shared workspace" />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[640px] px-4 pt-6 pb-12">
            {tasks === null ? null : tasks.length === 0 ? (
              <EmptyState image={ILL.happyMascot} title="Nothing assigned to you" description="When someone gives you a task in a shared workspace, it shows up here." />
            ) : (
              <div className="flex flex-col gap-6">
                <ul className="flex flex-col gap-2" aria-label="Open tasks">{open.map(row)}</ul>
                {done.length > 0 && (
                  <section aria-label="Done">
                    <h2 className="mb-2 text-[12px] font-semibold text-a-muted">Done</h2>
                    <ul className="flex flex-col gap-2">{done.map(row)}</ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </ViewLayoutContext.Provider>
  );
}
