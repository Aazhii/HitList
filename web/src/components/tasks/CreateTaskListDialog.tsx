import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LIST_COLORS } from '@/types/todo';
import { cn } from '@/lib/utils';

interface CreateTaskListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, color: string) => Promise<boolean>;
}

export function CreateTaskListDialog({ open, onOpenChange, onCreate }: CreateTaskListDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('emerald');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const changeOpen = (next: boolean) => {
    if (saving) return;
    if (!next) { setName(''); setColor('emerald'); setError(''); }
    onOpenChange(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      if (await onCreate(name.trim(), color)) {
        setName('');
        setColor('emerald');
      } else {
        setError('Could not save the list. Please try again.');
      }
    } catch {
      setError('Could not save the list. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Create a list</DialogTitle>
          <DialogDescription>Your task needs a list.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-list-name">List name</Label>
            <Input id="task-list-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={255} placeholder="Work or Personal" disabled={saving} required />
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="List colour">
            {LIST_COLORS.map((option) => (
              <button key={option.id} type="button" role="radio" aria-label={option.label} title={option.label} aria-checked={color === option.id} disabled={saving} onClick={() => setColor(option.id)} className={cn('size-7 rounded-[4px]', option.dot, color === option.id && 'ring-2 ring-a-ink ring-offset-2')} />
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => changeOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}><Plus className="size-4" />{saving ? 'Creating...' : 'Create list'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}