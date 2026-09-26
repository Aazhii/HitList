/** The custom fields block in the task detail panel. */
import { SlidersHorizontal } from 'lucide-react';
import { Label } from '@/components/ui/label';
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
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <SlidersHorizontal className="size-3" />
          Fields
        </Label>
        {online && fields.length > 0 && (
          <button type="button" onClick={onManage} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
            Manage
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-[11px] text-muted-foreground">Loading fields…</p>
      ) : !online ? (
        <p className="rounded-xl bg-muted/30 px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Custom fields need a connection to the server. Your fields and values are safe; they will show here once it is back.
        </p>
      ) : fields.length === 0 ? (
        <button
          type="button"
          onClick={onManage}
          className="w-full rounded-xl bg-muted/30 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-muted/50"
        >
          <p className="text-xs font-medium text-foreground">Add your own fields</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Picklists like Effort or Context, numbers, dates, checkboxes or text — on every task.
          </p>
        </button>
      ) : (
        <div className="space-y-2.5">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1">
              <p className="text-[11px] font-medium text-foreground">{field.name}</p>
              <FieldValueEditor field={field} value={values?.[field.id]} onChange={(v) => onSetValue(field.id, v)} />
            </div>
          ))}
          <p className="text-[10.5px] text-muted-foreground/70">Field values save as you change them.</p>
        </div>
      )}
    </div>
  );
}
