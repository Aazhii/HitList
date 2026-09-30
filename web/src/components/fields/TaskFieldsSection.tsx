/** The custom fields block in the task detail panel. */
import { topBarPill } from '@/components/shell/TopBar';
import { FieldValueEditor } from '@/components/fields/FieldValueEditor';
import type { FieldDef, FieldValue } from '@/types/fields';

interface TaskFieldsSectionProps {
  fields: FieldDef[];
  values: Record<string, FieldValue> | undefined;
  online: boolean;
  loading: boolean;
  onSetValue: (fieldId: string, value: FieldValue | null) => void;
  onManage: () => void;
}

export function TaskFieldsSection({ fields, values, online, loading, onSetValue, onManage }: TaskFieldsSectionProps) {
  // Showcase 1030–1035: a hairline, then "CUSTOM FIELDS" (11px / 600 / .06em, tertiary)
  // with a ghost "Manage fields", then each field as a labelled control 12px apart.
  return (
    <div className="flex flex-col gap-3 border-t border-a-line-soft pt-4">
      <div className="flex items-center">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-a-faint uppercase">Custom fields</span>
        <div className="flex-1" />
        {online && fields.length > 0 && (
          <button type="button" onClick={onManage} className={topBarPill}>
            Manage fields
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] text-a-faint">Loading fields…</p>
      ) : !online ? (
        <p className="rounded-[6px] bg-a-bg px-3.5 py-3 text-[12px] leading-relaxed text-a-faint">
          Custom fields need a connection to the server. Your fields and values are safe; they will show here once it is back.
        </p>
      ) : fields.length === 0 ? (
        <button
          type="button"
          onClick={onManage}
          className="w-full rounded-[6px] bg-a-bg px-3.5 py-3 text-left transition-colors duration-[120ms] hover:bg-a-line-soft"
        >
          <p className="text-[13px] font-medium text-a-ink">Add your own fields</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-a-faint">
            Picklists like Effort or Context, numbers, dates, checkboxes or text — on every task.
          </p>
        </button>
      ) : (
        fields.map((field) => (
          <div key={field.id} className="flex flex-col gap-2">
            <span className="text-[13px] leading-[1.35] font-medium text-a-ink">{field.name}</span>
            <FieldValueEditor field={field} value={values?.[field.id]} onChange={(v) => onSetValue(field.id, v)} />
          </div>
        ))
      )}
    </div>
  );
}
