/** The first step of a new rule: pick a ready-made starting point (or start from scratch), then adjust it in the builder. */
import { Bot } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RULE_TEMPLATES, type RuleTemplate } from '@/lib/automationSpec';

export function RuleTemplates({ open, onOpenChange, cliqAvailable, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cliq templates are marked when this is not the desktop app. */
  cliqAvailable: boolean;
  onPick: (template: RuleTemplate) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
          <DialogDescription>Start from one of these, then change anything you like.</DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-label="Rule templates">
          {RULE_TEMPLATES.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => onPick(template)}
                className="flex h-full w-full flex-col gap-1 rounded-[8px] border border-a-line bg-a-surface p-3.5 text-left transition-shadow duration-[120ms] hover:shadow-[var(--a-shadow-md)]"
              >
                <span className="flex items-center gap-1.5 text-[14px] font-semibold text-a-ink">
                  {template.usesCliq && <Bot className="size-[14px] flex-shrink-0 text-a-accent-700" strokeWidth={1.75} aria-hidden />}
                  {template.name}
                </span>
                <span className="text-[12px] text-a-muted">{template.description}</span>
                {template.usesCliq && !cliqAvailable && <span className="text-[11px] text-a-faint">Messages are sent by the desktop app.</span>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
