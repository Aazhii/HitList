/**
 * The record peek (showcase 765–784): a right-hand panel over the table — the record's title, then
 * one row per property, edited in place with the same cell editors the table uses.
 *
 * Net-new to the app. Deliberately no scrim: the table behind stays readable and clickable, like the
 * task detail panel. The prototype also draws a "Write something, or press “/” for blocks…" line under
 * the properties; a record has no body to write in, so it is left out rather than faked.
 */
import { useEffect, useState } from 'react';
import { ChevronsRight, Trash2 } from 'lucide-react';
import { FieldCell, KIND_ICON } from '@/components/databases/RecordTable';
import type { DatabaseTaskLinking } from '@/pages/DatabasesPage';
import type { ApiDatabaseRow } from '@/lib/api';
import type { FieldDef, FieldValue } from '@/types/fields';

export interface RecordPeekProps {
  record: ApiDatabaseRow;
  databaseName: string;
  fields: FieldDef[];
  values: Record<string, FieldValue> | undefined;
  linking?: DatabaseTaskLinking;
  onClose: () => void;
  onRename: (title: string) => void;
  onSetValue: (fieldId: string, value: FieldValue | null) => void;
  onDelete: () => void;
}

const ICON_BUTTON = 'flex size-7 items-center justify-center rounded-[4px] text-a-muted transition-colors duration-[120ms] hover:bg-a-line-soft hover:text-a-ink active:bg-a-line';

export function RecordPeek({ record, databaseName, fields, values, linking, onClose, onRename, onSetValue, onDelete }: RecordPeekProps) {
  const [title, setTitle] = useState(record.title);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { setTitle(record.title); setConfirming(false); }, [record.id, record.title]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== record.title) onRename(trimmed);
    else setTitle(record.title);
  };

  return (
    <aside
      role="dialog"
      aria-label="Record"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="fixed top-0 right-0 bottom-0 z-[60] flex w-[min(520px,100vw)] flex-col border-l border-a-line bg-a-surface text-[14px] leading-normal text-a-ink shadow-[var(--a-shadow-xl)] animate-in slide-in-from-right duration-[260ms]"
    >
      <header className="flex items-center gap-1.5 px-3 py-2.5">
        <button type="button" onClick={onClose} aria-label="Close" className={ICON_BUTTON}>
          <ChevronsRight className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <span className="min-w-0 truncate text-[13px] text-a-faint">{databaseName}</span>
        <div className="flex-1" />
        {confirming ? (
          <button
            type="button"
            onClick={onDelete}
            className="h-7 rounded-[4px] px-2 text-[12px] font-semibold text-q-do hover:bg-a-line-soft"
          >
            Delete for good
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} aria-label="Delete record" className={ICON_BUTTON}>
            <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto px-10 pt-[15px] pb-10">
        <input
          value={title}
          maxLength={255}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { setTitle(record.title); e.currentTarget.blur(); }
          }}
          placeholder="Untitled"
          aria-label="Title"
          // The prototype's 34px is outside the closed type scale; 32 is its nearest step.
          className="mb-4 w-full border-0 bg-transparent p-0 text-[32px] font-bold tracking-[-0.02em] text-a-ink outline-none placeholder:text-a-faint"
        />

        {fields.map((field) => {
          const Icon = KIND_ICON[field.kind];
          return (
            <div key={field.id} className="flex min-h-[34px] items-start gap-2 py-0.5">
              <div className="flex h-[30px] w-40 flex-none items-center gap-2 text-a-faint">
                <Icon className="size-[15px] flex-shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate text-[13px]">{field.name}</span>
              </div>
              <div className="flex min-h-[30px] min-w-0 flex-1 items-center rounded-[4px] px-1.5 hover:bg-a-line-soft">
                <FieldCell
                  def={field}
                  value={values?.[field.id]}
                  recordId={record.id}
                  recordName={record.title}
                  onChange={(value) => onSetValue(field.id, value)}
                  linking={linking}
                  peek
                />
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
