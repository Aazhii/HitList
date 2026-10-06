import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** The shortcuts the app actually has, so the list can be trusted. */
const SHORTCUTS: Array<{ keys: string; does: string }> = [
  { keys: 'c  /  ⌘ / Ctrl + ⇧ + N', does: 'Quick add: one line, with a date, time or !quadrant in it' },
  { keys: 'l  /  ⌘ / Ctrl + L', does: 'Log progress: one line about what moved, finished or not, for your weekly update' },
  { keys: '/', does: 'In a note or on an empty line: choose a block type' },
  { keys: '@', does: 'In a note or a text cell: add the line to a quadrant' },
  { keys: '↵', does: 'In a note: start a new block' },
  { keys: 'Tab', does: 'In a note: push the line in one level (in a table: next cell; in code: two spaces)' },
  { keys: 'Shift Tab', does: 'In a note: bring the line back out one level' },
  { keys: '⌘ / Ctrl + B, I, U', does: 'Bold, italic, underline the selection' },
  { keys: '⌘ / Ctrl + ⇧ + X', does: 'Strike the selection through' },
  { keys: '⌘ / Ctrl + K', does: 'Search tasks, notes, databases and lists' },
  { keys: 'j k  /  ↑ ↓', does: 'In the table or board: move the cursor between tasks' },
  { keys: 'h l  /  ← →', does: 'In the table or board: move across cells or columns' },
  { keys: '↵  /  o', does: 'In the table or board: edit the cell, or open the task' },
  { keys: 'x', does: 'In the table or board: mark the task done, or open again' },
  { keys: 'Space', does: 'In the table: select the row, for bulk actions' },
  { keys: '[  ]', does: 'In the table or board: move the task one quadrant' },
  { keys: '↑ ↓ ← →', does: 'In a menu: move; ↵ chooses, Esc closes' },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>What you can type or press in HitList.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col">
          {SHORTCUTS.map(({ keys, does }) => (
            <div key={keys} className="flex items-baseline gap-3 border-b border-a-line-soft py-2 last:border-b-0">
              <dt className="w-[140px] flex-shrink-0 font-mono text-[12px] text-a-ink">{keys}</dt>
              <dd className="flex-1 text-a-muted">{does}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
