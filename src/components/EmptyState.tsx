import { Plus, Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  onAdd?: () => void;
}

export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-primary/10">
        <Sprout className="size-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">Start small, grow daily</h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
        Kaizen is about one small step at a time — what's yours today?
      </p>
      {onAdd && (
        <Button
          onClick={onAdd}
          className="mt-6 gap-2 rounded-xl px-5"
          size="sm"
        >
          <Plus className="size-3.5" />
          Add your first task
        </Button>
      )}
    </div>
  );
}
