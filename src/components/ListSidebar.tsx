import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Check, Pencil, ListTodo, X, StickyNote, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { KaizenList } from '@/types/todo';
import { getListColorDot, LIST_COLORS } from '@/types/todo';

interface ListSidebarProps {
  lists: KaizenList[];
  activeListId: string;
  todoCounts: Record<string, { active: number; done: number }>;
  onSelectList: (id: string) => void;
  onCreateList: (name: string, color: string) => void;
  onRenameList: (id: string, name: string) => void;
  onDeleteList: (id: string) => void;
  onClose?: () => void;
  isMobile?: boolean;
  activeView?: 'tasks' | 'notes' | 'automations';
  onViewChange?: (view: 'tasks' | 'notes' | 'automations') => void;
  notesCount?: number;
  automationsCount?: number;
  /** True while the initial server load is in progress */
  loading?: boolean;
}

export function ListSidebar({
  lists,
  activeListId,
  todoCounts,
  onSelectList,
  onCreateList,
  onRenameList,
  onDeleteList,
  onClose,
  isMobile,
  activeView = 'tasks',
  onViewChange,
  notesCount = 0,
  automationsCount = 0,
  loading = false,
}: ListSidebarProps) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('emerald');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<KaizenList | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creatingNew) newInputRef.current?.focus();
  }, [creatingNew]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateList(name, newColor);
    setNewName('');
    setNewColor('emerald');
    setCreatingNew(false);
  };

  const handleRenameStart = (list: KaizenList) => {
    setRenamingId(list.id);
    setRenameValue(list.name);
  };

  const handleRenameCommit = () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (name) onRenameList(renamingId, name);
    setRenamingId(null);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    onDeleteList(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <aside
        className={cn(
          'flex flex-col h-full bg-card border-r border-border',
          isMobile ? 'w-full' : 'w-64'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <ListTodo className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Kaizen</span>
          </div>
          {isMobile && onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close sidebar">
              <X className="size-4" />
            </Button>
          )}
        </div>

        {/* View switcher */}
        <div className="px-2 pb-2 flex-shrink-0 space-y-0.5">
          {/* Tasks / Notes row */}
          <div className="flex rounded-xl bg-muted/40 p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => onViewChange?.('tasks')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-7 rounded-lg text-xs font-medium transition-all duration-150',
                activeView === 'tasks'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <ListTodo className="size-3" />
              Tasks
            </button>
            <button
              type="button"
              onClick={() => onViewChange?.('notes')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-7 rounded-lg text-xs font-medium transition-all duration-150',
                activeView === 'notes'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <StickyNote className="size-3" />
              Notes
              {notesCount > 0 && (
                <span className={cn(
                  'flex size-4 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums',
                  activeView === 'notes' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  {notesCount > 99 ? '99+' : notesCount}
                </span>
              )}
            </button>
          </div>
          {/* Automations row */}
          <button
            type="button"
            onClick={() => onViewChange?.('automations')}
            className={cn(
              'w-full flex items-center gap-2 h-8 rounded-xl px-3 text-xs font-medium transition-all duration-150',
              activeView === 'automations'
                ? 'bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            <Zap className="size-3 flex-shrink-0" />
            <span className="flex-1 text-left">Automations</span>
            {automationsCount > 0 && (
              <span className={cn(
                'flex size-4 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums',
                activeView === 'automations' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
              )}>
                {automationsCount > 99 ? '99+' : automationsCount}
              </span>
            )}
          </button>
        </div>

        {/* Notes view: placeholder in sidebar */}
        {activeView === 'notes' && (
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center">
            <StickyNote className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground/60 leading-relaxed">
              Notes are shown in the main area. Select or create a note to get started.
            </p>
          </div>
        )}

        {/* Automations view: placeholder in sidebar */}
        {activeView === 'automations' && (
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center">
            <Zap className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground/60 leading-relaxed">
              Automation rules are shown in the main area.
            </p>
          </div>
        )}

        {/* Tasks view: list items */}
        {activeView === 'tasks' && (
          <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
            {/* Loading skeleton — shown while initial server fetch is in progress */}
            {loading && lists.length === 0 && (
              <div className="space-y-1 px-1 pt-1 animate-pulse">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5">
                    <div className="size-2 rounded-full bg-muted-foreground/20 flex-shrink-0" />
                    <div className="h-3 rounded bg-muted-foreground/15 flex-1" style={{ width: `${60 + i * 15}%` }} />
                  </div>
                ))}
              </div>
            )}
            {/* Empty state — shown after load completes with no lists */}
            {!loading && lists.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <ListTodo className="size-7 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                  No lists yet. Create one below.
                </p>
              </div>
            )}
            {lists.map((list) => {
              const isActive = list.id === activeListId;
              const counts = todoCounts[list.id] ?? { active: 0, done: 0 };
              const isRenaming = renamingId === list.id;
              const dotClass = getListColorDot(list.color);

              return (
                <div
                  key={list.id}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer transition-all duration-150',
                    isActive
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                  onClick={() => {
                    if (!isRenaming) {
                      onSelectList(list.id);
                      if (isMobile && onClose) onClose();
                    }
                  }}
                >
                  <span className={cn('size-2 rounded-full flex-shrink-0', dotClass)} />

                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRenameCommit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameCommit();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground outline-none border-b border-primary"
                      aria-label="Rename list"
                    />
                  ) : (
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{list.name}</span>
                  )}

                  {counts.active > 0 && !isRenaming && (
                    <span
                      className={cn(
                        'flex-shrink-0 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums transition-colors duration-150',
                        isActive
                          ? 'bg-primary/20 text-primary'
                          : 'bg-muted text-muted-foreground group-hover:bg-muted/80'
                      )}
                    >
                      {counts.active}
                    </span>
                  )}

                  {!isRenaming && (
                    <div className="absolute right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRenameStart(list); }}
                        aria-label="Rename list"
                        className="flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
                      >
                        <Pencil className="size-3" />
                      </button>
                      {lists.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(list); }}
                          aria-label="Delete list"
                          className="flex size-6 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* New list form */}
            {creatingNew && (
              <div className="mt-1 rounded-xl border border-border bg-muted/30 p-3 space-y-2.5 animate-fade-in">
                <Input
                  ref={newInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') setCreatingNew(false);
                  }}
                  placeholder="List name…"
                  className="h-8 text-sm rounded-lg"
                  aria-label="New list name"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  {LIST_COLORS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setNewColor(c.id)}
                      aria-label={`Color: ${c.label}`}
                      className={cn(
                        'size-5 rounded-full transition-all duration-150',
                        c.dot,
                        newColor === c.id ? 'ring-2 ring-offset-1 ring-foreground/30 scale-110' : 'opacity-60 hover:opacity-100'
                      )}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="h-7 rounded-lg text-xs flex-1">
                    <Check className="size-3 mr-1" /> Create
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCreatingNew(false); setNewName(''); }} className="h-7 rounded-lg text-xs">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* New list button — only in tasks view */}
        {activeView === 'tasks' && !creatingNew && (
          <div className="px-2 pb-4 pt-1 border-t border-border/60 mt-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreatingNew(true)}
              className="w-full h-8 rounded-xl text-xs text-muted-foreground hover:text-foreground gap-1.5 justify-start"
            >
              <Plus className="size-3.5" />
              New list
            </Button>
          </div>
        )}
      </aside>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              All tasks in this list will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
