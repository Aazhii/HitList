import { useEffect, useRef, useState } from 'react';
import { Search, X, SlidersHorizontal, ArrowUpDown, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TaskListParams } from '@/lib/api';

export interface FilterState {
  search:    string;
  status:    string;   // '' | 'TODO' | 'IN_PROGRESS' | 'DONE'
  priority:  string;   // '' | 'HIGH' | 'MEDIUM' | 'LOW'
  quadrant:  string;   // '' | 'DO' | 'SCHEDULE' | 'DELEGATE' | 'ELIMINATE'
  dueBefore: string;   // YYYY-MM-DD or ''
  dueAfter:  string;   // YYYY-MM-DD or ''
  sortBy:    TaskListParams['sortBy'];
  sortDir:   'asc' | 'desc';
}

export const DEFAULT_FILTERS: FilterState = {
  search:    '',
  status:    '',
  priority:  '',
  quadrant:  '',
  dueBefore: '',
  dueAfter:  '',
  sortBy:    'order',
  sortDir:   'asc',
};

export function filtersToParams(f: FilterState): TaskListParams {
  const p: TaskListParams = {};
  if (f.search)    p.search    = f.search;
  if (f.status)    p.status    = f.status;
  if (f.priority)  p.priority  = f.priority;
  if (f.quadrant)  p.quadrant  = f.quadrant;
  if (f.dueBefore) p.dueBefore = f.dueBefore;
  if (f.dueAfter)  p.dueAfter  = f.dueAfter;
  if (f.sortBy && f.sortBy !== 'order') p.sortBy = f.sortBy;
  if (f.sortDir === 'desc') p.sortDir = 'desc';
  return p;
}

export function countActiveFilters(f: FilterState): number {
  let n = 0;
  if (f.search)    n++;
  if (f.status)    n++;
  if (f.priority)  n++;
  if (f.quadrant)  n++;
  if (f.dueBefore) n++;
  if (f.dueAfter)  n++;
  if (f.sortBy && f.sortBy !== 'order') n++;
  if (f.sortDir === 'desc') n++;
  return n;
}

interface AdvancedFilterBarProps {
  filters:   FilterState;
  onChange:  (f: FilterState) => void;
  className?: string;
}

export function AdvancedFilterBar({ filters, onChange, className }: AdvancedFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [localSearch, setLocalSearch] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync localSearch when filters reset externally
  useEffect(() => {
    setLocalSearch(filters.search);
  }, [filters.search]);

  const handleSearchChange = (val: string) => {
    setLocalSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange({ ...filters, search: val });
    }, 300);
  };

  const set = (key: keyof FilterState, val: string) => {
    onChange({ ...filters, [key]: val });
  };

  const clearAll = () => {
    setLocalSearch('');
    onChange(DEFAULT_FILTERS);
  };

  const activeCount = countActiveFilters(filters);

  return (
    <div className={cn('space-y-2', className)}>
      {/* Primary row: search + filter toggle */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search tasks…"
            className="pl-8 h-8 text-xs rounded-xl bg-muted/40 border-border/60 focus-visible:ring-1"
            aria-label="Search tasks"
          />
          {localSearch && (
            <button
              type="button"
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <ArrowUpDown className="size-3.5 text-muted-foreground/70 flex-shrink-0" />
          <Select value={filters.sortBy ?? 'order'} onValueChange={(v) => set('sortBy', v)}>
            <SelectTrigger size="sm" className="h-8 rounded-xl border-border/60 bg-muted/40 text-xs px-2.5 gap-1 min-w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order">Manual order</SelectItem>
              <SelectItem value="created">Date added</SelectItem>
              <SelectItem value="due-date">Due date</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => set('sortDir', filters.sortDir === 'asc' ? 'desc' : 'asc')}
            className="size-8 rounded-xl text-muted-foreground hover:text-foreground"
            aria-label={filters.sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
            title={filters.sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            <span className="text-[10px] font-bold">{filters.sortDir === 'asc' ? '↑' : '↓'}</span>
          </Button>
        </div>

        {/* Filter toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'h-8 rounded-xl px-2.5 text-xs gap-1.5 transition-colors duration-150 flex-shrink-0',
            (expanded || activeCount > 0)
              ? 'bg-primary/10 text-primary hover:bg-primary/15'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-expanded={expanded}
          aria-label="Toggle filters"
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <Badge className="h-4 min-w-4 px-1 text-[9px] font-bold bg-primary text-primary-foreground rounded-full">
              {activeCount}
            </Badge>
          )}
          <ChevronDown className={cn('size-3 transition-transform duration-150', expanded && 'rotate-180')} />
        </Button>

        {/* Clear all */}
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-8 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground gap-1 flex-shrink-0 animate-fade-in"
            aria-label="Clear all filters"
          >
            <X className="size-3" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>

      {/* Expanded filter row */}
      {expanded && (
        <div className="flex items-center gap-2 flex-wrap animate-fade-in">
          {/* Status */}
          <Select value={filters.status || '__all__'} onValueChange={(v) => set('status', v === '__all__' ? '' : v)}>
            <SelectTrigger size="sm" className="h-7 rounded-xl border-border/60 bg-muted/40 text-xs px-2.5 gap-1 min-w-[100px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__"><span className="text-muted-foreground">All statuses</span></SelectItem>
              <SelectItem value="TODO">To do</SelectItem>
              <SelectItem value="IN_PROGRESS">In progress</SelectItem>
              <SelectItem value="DONE">Done</SelectItem>
            </SelectContent>
          </Select>

          {/* Priority */}
          <Select value={filters.priority || '__all__'} onValueChange={(v) => set('priority', v === '__all__' ? '' : v)}>
            <SelectTrigger size="sm" className="h-7 rounded-xl border-border/60 bg-muted/40 text-xs px-2.5 gap-1 min-w-[100px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__"><span className="text-muted-foreground">All priorities</span></SelectItem>
              <SelectItem value="HIGH">🔴 High</SelectItem>
              <SelectItem value="MEDIUM">🟡 Medium</SelectItem>
              <SelectItem value="LOW">🟢 Low</SelectItem>
            </SelectContent>
          </Select>

          {/* Quadrant */}
          <Select value={filters.quadrant || '__all__'} onValueChange={(v) => set('quadrant', v === '__all__' ? '' : v)}>
            <SelectTrigger size="sm" className="h-7 rounded-xl border-border/60 bg-muted/40 text-xs px-2.5 gap-1 min-w-[120px]">
              <SelectValue placeholder="Quadrant" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__"><span className="text-muted-foreground">All quadrants</span></SelectItem>
              <SelectItem value="DO">Do first</SelectItem>
              <SelectItem value="SCHEDULE">Schedule</SelectItem>
              <SelectItem value="DELEGATE">Delegate</SelectItem>
              <SelectItem value="ELIMINATE">Eliminate</SelectItem>
            </SelectContent>
          </Select>

          {/* Due after */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground font-medium">From</span>
            <Input
              type="date"
              value={filters.dueAfter}
              onChange={(e) => set('dueAfter', e.target.value)}
              className="h-7 text-xs rounded-xl border-border/60 bg-muted/40 w-[130px] px-2"
              aria-label="Due after date"
            />
          </div>

          {/* Due before */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground font-medium">To</span>
            <Input
              type="date"
              value={filters.dueBefore}
              onChange={(e) => set('dueBefore', e.target.value)}
              className="h-7 text-xs rounded-xl border-border/60 bg-muted/40 w-[130px] px-2"
              aria-label="Due before date"
            />
          </div>
        </div>
      )}
    </div>
  );
}
