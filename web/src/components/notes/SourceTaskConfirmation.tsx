import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { memberLabel } from '@/lib/workspaceMessage';
import type { SourceTaskConsent } from '@/hooks/useSourceTaskAssignment';

export function SourceTaskConfirmation({ consent, onDecision }: { consent: SourceTaskConsent | null; onDecision: (confirmed: boolean) => void }) {
  return <Dialog open={!!consent} onOpenChange={(open) => { if (!open) onDecision(false); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Share entire {consent?.kind === 'note' ? 'page' : 'database'} and create task?</DialogTitle>
        <DialogDescription>
          {consent?.kind === 'note' ? 'All content on this page' : 'The entire database, including all records, columns and values'} will be shared with every member of {consent?.workspace.name}, not only the task recipient.
          {' '}The first share creates a snapshot. Your personal original stays separate and does not automatically sync. Repeat sharing opens the existing shared copy without replacing its edits. Make future shared edits in that copy.
        </DialogDescription>
      </DialogHeader>
      <p className="text-[14px] font-medium text-a-ink [overflow-wrap:anywhere]">{consent?.title}</p>
      <ul aria-label="Source recipients" className="space-y-1 text-[14px] text-a-ink">
        {consent?.workspace.members.map((member) => <li key={member.userId} className="[overflow-wrap:anywhere]">{memberLabel(member)} <span className="text-a-muted">{member.email}</span></li>)}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={() => onDecision(false)}>Cancel</Button>
        <Button onClick={() => onDecision(true)}>Share and create task</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}