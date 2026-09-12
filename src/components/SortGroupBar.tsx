import { ArrowUpDown, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { SortOption, GroupOption } from '@/types/todo';

interface SortGroupBarProps {
  sort: SortOption;
  group: GroupOption;
  onSortChange: (sort: SortOption) => void;
  onGroupChange: (group: GroupOption) => void;
}

const SORT_LABELS: Record<SortOption, string> = {
  created: 'Date added',
  'due-date': 'Due date',
  status: 'Status',
  order: 'Manual order',
};

export function SortGroupBar({ sort, group, onSortChange, onGroupChange }: SortGroupBarProps) {
  const isGrouped = group === 'category';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Sort */}
      <div className="flex items-center gap-1.5">
        <ArrowUpDown className="size-3.5 text-muted-foreground/70 flex-shrink-0" />
        <Select value={sort} onValueChange={(v) => onSortChange(v as SortOption)}>
          <SelectTrigger
            size="sm"
            className="h-7 rounded-xl border-border/60 bg-muted/40 text-xs px-2.5 gap-1 min-w-[100px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created">Date added</SelectItem>
            <SelectItem value="due-date">Due date</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Group by category toggle */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onGroupChange(isGrouped ? 'none' : 'category')}
        className={cn(
          'h-7 rounded-xl px-2.5 text-xs gap-1.5 transition-colors duration-150',
          isGrouped
            ? 'bg-primary/10 text-primary hover:bg-primary/15'
            : 'text-muted-foreground hover:text-foreground'
        )}
        aria-pressed={isGrouped}
      >
        <Layers className="size-3.5" />
        Group
      </Button>
    </div>
  );
}
