/**
 * The question asked before tasks are completed: "this still needs other tasks first". One gate for every place a task can be
 * completed (tick, status menu, bulk bar), so the answer is the same everywhere. It never changes a task by itself except for the
 * prerequisites when the person chooses "Finish them too".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NeedsDecision, NeedsGroup } from '@/components/tasks/NeedsFirstDialog';
import { needsToFinish, openNeeds } from '@/lib/taskNeeds';
import type { Todo, TodoStatus } from '@/types/todo';

export interface NeedsPrompt { groups: NeedsGroup[]; total: number; resolve: (decision: NeedsDecision) => void }

export function useNeedsFirstGate(todos: readonly Todo[], applyStatusChange: (id: string, status: TodoStatus) => Promise<void>) {
  const todosNow = useRef(todos);
  useEffect(() => { todosNow.current = todos; });
  const [prompt, setPrompt] = useState<NeedsPrompt | null>(null);

  /**
   * Whether these tasks may be completed now. When some still wait on others it asks (Finish them too / Complete anyway / Cancel);
   * "Finish them too" completes what they need first (deepest first), then the answer is yes. Resolves false when the person cancels.
   */
  const guardCompletion = useCallback(async (ids: string[]): Promise<boolean> => {
    const byId = new Map(todosNow.current.map((t) => [t.id, t]));
    const groups: NeedsGroup[] = [];
    for (const id of ids) {
      const task = byId.get(id);
      if (!task || task.status === 'done') continue;
      const open = openNeeds(task, byId);
      if (open.length) groups.push({ task, open });
    }
    if (groups.length === 0) return true;
    const decision = await new Promise<NeedsDecision>((resolve) => setPrompt({ groups, total: ids.length, resolve }));
    setPrompt(null);
    if (decision === 'cancel') return false;
    if (decision === 'finish') {
      for (const id of needsToFinish(groups.map((g) => g.task), byId)) await applyStatusChange(id, 'done');
    }
    return true;
  }, [applyStatusChange]);

  const decide = useCallback((decision: NeedsDecision) => prompt?.resolve(decision), [prompt]);
  return { prompt, decide, guardCompletion };
}
