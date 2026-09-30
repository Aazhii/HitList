/**
 * A text column's cell: a plain editable input, plus the same "@" → add to
 * quadrant menu the notes editor has, using the record's own text as the
 * would-be task's title.
 *
 * Reuses notes' MentionMenu/LinkedTaskChip/detectMentionTrigger wholesale —
 * this is the same feature, just keyed by (recordId, fieldId) instead of
 * (noteId, blockId), so nothing about the menu or the chip needed to change.
 * A cell is "linked" purely by there being a task whose sourceRecordId/
 * sourceFieldId point back at it — no pointer is stored on the field value
 * itself, so existing text values need no migration.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getCaretCoordinates } from '@/lib/caretCoordinates';
import {
  detectMentionTrigger, removeMentionTrigger, taskTitleFromText, type MentionTrigger,
} from '@/lib/noteMentions';
import { MentionMenu, type MentionMenuHandle } from '@/components/notes/MentionMenu';
import { LinkedTaskChip } from '@/components/notes/LinkedTaskChip';
import type { Quadrant } from '@/types/todo';
import type { DatabaseTaskLinking } from '@/pages/DatabasesPage';

interface TextFieldCellProps {
  recordId: string;
  fieldId: string;
  value: string | undefined;
  ariaLabel: string;
  onChange: (value: string | null) => void;
  linking?: DatabaseTaskLinking;
  className: string;
}

export function TextFieldCell({ recordId, fieldId, value, ariaLabel, onChange, linking, className }: TextFieldCellProps) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const inputRef = useRef<HTMLInputElement>(null);
  const mentionRef = useRef<MentionMenuHandle>(null);
  const [mention, setMention] = useState<{
    trigger: MentionTrigger;
    position: { top: number; left: number };
    message: string | null;
  } | null>(null);
  const [pending, setPending] = useState(false);

  const linkedTask = useMemo(
    () => linking?.todos.find((t) => t.sourceRecordId === recordId && t.sourceFieldId === fieldId),
    [linking?.todos, recordId, fieldId],
  );

  const commit = (next: string) => {
    if (next === (value ?? '')) return;
    onChange(next.trim() === '' ? null : next);
  };

  const checkMention = useCallback((el: HTMLInputElement) => {
    if (!linking || linkedTask || pending) { setMention(null); return; }
    const trigger = detectMentionTrigger(el.value, el.selectionStart ?? el.value.length);
    if (!trigger) { setMention((m) => (m ? null : m)); return; }

    const message = taskTitleFromText(removeMentionTrigger(el.value, trigger).content)
      ? null
      : 'Write the column text first, then type @';

    setMention((m) => {
      if (m && m.trigger.at === trigger.at) return { ...m, trigger, message };
      let position: { top: number; left: number };
      try {
        const coords = getCaretCoordinates(el, trigger.at);
        position = { top: coords.top + 22, left: coords.left };
      } catch {
        const rect = el.getBoundingClientRect();
        position = { top: rect.bottom + 4, left: rect.left };
      }
      return { trigger, position, message };
    });
  }, [linking, linkedTask, pending]);

  // Close the "@" menu on a click outside it.
  useEffect(() => {
    if (!mention) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-mention-menu]')) setMention(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mention]);

  const handleMentionSelect = useCallback(async (listId: string, quadrant: Quadrant) => {
    if (!mention || !linking) return;
    const el = inputRef.current;
    const original = el?.value ?? draft;
    const { content, caret } = removeMentionTrigger(original, mention.trigger);
    const title = taskTitleFromText(content);
    if (!title) {
      setMention((m) => (m ? { ...m, message: 'Write the column text first, then type @' } : m));
      return;
    }

    setMention(null);
    setPending(true);
    setDraft(content);
    commit(content);
    requestAnimationFrame(() => el?.setSelectionRange(caret, caret));

    const task = await linking.createTask({ listId, quadrant, title, recordId, fieldId });
    setPending(false);

    if (!task) {
      // Put the "@query" back — but only if the cell hasn't been edited
      // meanwhile, so a failure never overwrites newer typing.
      setDraft((current) => {
        if (current !== content) return current;
        commit(original);
        return original;
      });
    }
  }, [mention, linking, draft, recordId, fieldId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mention && mentionRef.current) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        if (mentionRef.current.handleKey(e.key)) { e.preventDefault(); return; }
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
    if (e.key === 'Escape') { setDraft(value ?? ''); (e.target as HTMLInputElement).blur(); }
  };

  return (
    <div className="flex min-h-6 flex-wrap items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        maxLength={2000}
        onChange={(e) => {
          setDraft(e.target.value);
          checkMention(e.target);
          // A linked cell's text is its task's title; a cleared cell keeps the
          // task's last title rather than blanking it.
          if (linkedTask && linking) {
            const title = taskTitleFromText(e.target.value);
            if (title) linking.updateTaskTitle(linkedTask.id, title);
          }
        }}
        onBlur={() => { commit(draft); setMention(null); }}
        onKeyDown={handleKeyDown}
        placeholder=""
        aria-label={ariaLabel}
        className={cn(className, 'min-w-[80px] flex-1 placeholder:text-a-faint/60')}
      />
      {(linkedTask || pending) && linking && (
        <LinkedTaskChip
          task={linkedTask}
          lists={linking.lists}
          pending={pending}
          onOpen={linking.openTask}
          onUnlink={() => { if (linkedTask) linking.unlinkTask(linkedTask.id); }}
        />
      )}
      {mention && linking && (
        <MentionMenu
          ref={mentionRef}
          position={mention.position}
          lists={linking.lists}
          preferredListId={linking.preferredListId}
          query={mention.trigger.query}
          pending={false}
          message={mention.message}
          contextLabel="Column"
          onSelect={(listId, quadrant) => { void handleMentionSelect(listId, quadrant); }}
          onClose={() => setMention(null)}
        />
      )}
    </div>
  );
}
