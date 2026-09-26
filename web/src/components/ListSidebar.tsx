import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Check, Pencil, ListTodo } from 'lucide-react';
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
import {
  ContextSectionHeader,
  contextIconButton,
  contextRowClass,
  useViewLayout,
} from '@/components/shell/ViewLayout';

interface ListSidebarProps {
  lists: KaizenList[];
  activeListId: string;
  todoCounts: Record<string, { active: number; done: number }>;
  onSelectList: (id: string) => void;
  onCreateList: (name: string, color: string) => void;
  onRenameList: (id: string, name: string) => void;
  onDeleteList: (id: string) => void;
  /** True while the initial server load is in progress */
  loading?: boolean;
}

/**
 * The tasks view's lists, in the shell's context column.
 *
 * It used to be a whole sidebar with its own header and a Tasks / Notes /
 * Automations switcher. The switcher now lives in the icon rail; this is just
 * the lists — as 36px pills, with create, rename and delete unchanged.
 */
export function ListSidebar({
  lists,
  activeListId,
  todoCounts,
  onSelectList,
  onCreateList,
  onRenameList,
  onDeleteList,
  loading = false,
}: ListSidebarProps) {
  const { closeContext } = useViewLayout();
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
      <ContextSectionHeader
        label="Lists"
        action={
          <button
            type="button"
            onClick={() => setCreatingNew(true)}
            className={contextIconButton}
            aria-label="New list"
            title="New list"
          >
            <Plus className="size-3.5" strokeWidth={2.75} />
          </button>
        }
      />

      {/* Loading skeleton — shown while the initial server fetch is in progress */}
      {loading && lists.length === 0 && (
        <div className="space-y-1 px-1 animate-pulse" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-9 items-center gap-2.5 px-3">
              <div className="size-2 rounded-full bg-a-line" />
              <div className="h-3 rounded-full bg-a-line" style={{ width: `${55 + i * 15}%` }} />
            </div>
          ))}
        </div>
      )}

      {!loading && lists.length === 0 && (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <ListTodo className="mb-2 size-6 text-a-faint/60" strokeWidth={2.25} />
          <p className="text-[13px] leading-relaxed text-a-faint">No lists yet. Create one with +.</p>
        </div>
      )}

      <ul className="space-y-0.5">
        {lists.map((list) => {
          const isActive = list.id === activeListId;
          const counts = todoCounts[list.id] ?? { active: 0, done: 0 };
          const isRenaming = renamingId === list.id;
          const dotClass = getListColorDot(list.color);

          if (isRenaming) {
            return (
              <li key={list.id} className={contextRowClass(true)}>
                <span className={cn('size-2 flex-shrink-0 rounded-full', dotClass)} aria-hidden />
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRenameCommit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameCommit();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="min-w-0 flex-1 border-b border-a-accent bg-transparent text-[14.5px] font-semibold text-a-ink outline-none"
                  aria-label="Rename list"
                />
              </li>
            );
          }

          return (
            <li key={list.id} className="group relative">
              <button
                type="button"
                onClick={() => { onSelectList(list.id); closeContext(); }}
                aria-current={isActive ? 'true' : undefined}
                className={contextRowClass(isActive)}
              >
                <span className={cn('size-2 flex-shrink-0 rounded-full', dotClass)} aria-hidden />
                <span className={cn(
                  'min-w-0 flex-1 truncate text-[14.5px]',
                  isActive ? 'font-semibold text-a-ink' : 'text-a-muted',
                )}>
                  {list.name}
                </span>
                {counts.active > 0 && (
                  <span
                    className={cn(
                      'text-[12.5px] tabular-nums transition-opacity duration-150',
                      'group-hover:opacity-0 group-focus-within:opacity-0',
                      isActive ? 'font-bold text-a-accent-700' : 'text-a-faint',
                    )}
                  >
                    {counts.active}
                    <span className="sr-only"> open</span>
                  </span>
                )}
              </button>

              {/* Siblings of the row button, not children: no nested interactive elements. */}
              <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => handleRenameStart(list)}
                  aria-label={`Rename ${list.name}`}
                  className={contextIconButton}
                >
                  <Pencil className="size-3" strokeWidth={2.75} />
                </button>
                {lists.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(list)}
                    aria-label={`Delete ${list.name}`}
                    className={cn(contextIconButton, 'hover:text-q-do')}
                  >
                    <Trash2 className="size-3" strokeWidth={2.75} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {creatingNew && (
        <div className="mx-1 mt-2 space-y-2.5 rounded-[14px] bg-a-bg p-3 shadow-[inset_0_0_0_1px_var(--a-line)] animate-fade-in">
          <Input
            ref={newInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setCreatingNew(false);
            }}
            placeholder="List name…"
            className="h-8 rounded-full text-[14px]"
            aria-label="New list name"
          />
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="List colour">
            {LIST_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={newColor === c.id}
                onClick={() => setNewColor(c.id)}
                aria-label={c.label}
                className={cn(
                  'size-5 rounded-full transition-all duration-150',
                  c.dot,
                  newColor === c.id
                    ? 'scale-110 ring-2 ring-a-ink/40 ring-offset-2 ring-offset-a-bg'
                    : 'opacity-60 hover:opacity-100',
                )}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="h-7 flex-1 rounded-full text-xs">
              <Check className="mr-1 size-3" /> Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setCreatingNew(false); setNewName(''); }}
              className="h-7 rounded-full text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

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
              className="bg-destructive text-a-bg hover:bg-destructive/90"
            >
              Delete list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
