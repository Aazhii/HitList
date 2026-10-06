import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { openWorkspace, type SharedWorkspace } from '@/lib/workspaceStore';
import { sourceLocation, sourceTaskRequest, type SourceTaskInput, type SourceKind } from '@/lib/sharedSource';
import { flushSourceSaves } from '@/lib/sourceSaves';

export interface SourceTaskConsent { workspace: SharedWorkspace; kind: SourceKind; title: string }

export function useSourceTaskAssignment() {
  const workspaces = useWorkspaces();
  const [consent, setConsent] = useState<SourceTaskConsent | null>(null);
  const decision = useRef<((confirmed: boolean) => void) | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const requests = useRef(new Map<string, ReturnType<typeof sourceTaskRequest>>());
  useEffect(() => {
    mounted.current = true;
    const savedRequests = requests.current;
    return () => { mounted.current = false; decision.current?.(false); savedRequests.clear(); };
  }, []);

  const decide = (confirmed: boolean) => {
    decision.current?.(confirmed);
    decision.current = null;
    setConsent(null);
  };

  const createTask = async (input: SourceTaskInput): Promise<null> => {
    if (!mounted.current || busy.current) return null;
    const workspace = workspaces.workspaces.find((candidate) => candidate.workspaceId === input.workspaceId && candidate.state === 'active');
    if (!workspaces.available || !workspace?.members.length || !workspace.members.some((member) => member.userId === input.assigneeUserId)) {
      toast.error('Choose an active workspace and one of its members.');
      return null;
    }
    busy.current = true;
    try {
      const confirmed = await new Promise<boolean>((resolve) => {
        decision.current = resolve;
        setConsent({ workspace, kind: input.sourceNoteId ? 'note' : 'database', title: input.title });
      });
      if (!confirmed || !mounted.current) return null;
      // Sharing a note depends on that note being saved, not on unrelated database edits.
      await flushSourceSaves({ ignoreFailedWrites: !!input.sourceNoteId && !input.sourceRecordId });
      if (!mounted.current) return null;
      const key = JSON.stringify(input);
      let request = requests.current.get(key);
      if (!request) { request = sourceTaskRequest(input); requests.current.set(key, request); }
      const saved = await request();
      if (!mounted.current) return null;
      const recordId = input.sourceRecordId ? saved.source.recordIds[input.sourceRecordId] ?? saved.task.sourceRecordId ?? undefined : undefined;
      const location = sourceLocation(input.workspaceId, saved.source.kind, saved.source.id, recordId);
      const open = () => openWorkspace(input.workspaceId, location);
      if (!await open()) {
        toast.error('Task saved, but the workspace could not be opened.', {
          description: 'Open the shared source to continue. Do not create another task.',
          duration: Infinity,
          action: { label: 'Open shared source', onClick: () => { void open(); } },
        });
      }
    } catch (failure) {
      if (mounted.current) toast.error(failure instanceof Error ? failure.message : 'Could not confirm task creation.', {
        description: 'Retry the same assignment to avoid duplicates. Your personal source remains separate.',
        duration: Infinity,
        action: { label: 'Retry assignment', onClick: () => { void createTask(input); } },
      });
    } finally { busy.current = false; }
    return null;
  };

  return { consent, decide, createTask };
}