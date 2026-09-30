/**
 * A column header's menu — showcase 651–694, in its order: the property name, Change type,
 * Edit options (select kinds), then Filter, Sort ascending / descending, Group, Calculate,
 * Freeze, Hide, Wrap content, Insert left / right, Duplicate, Delete. Change type, Edit
 * options and Calculate open as panels beside it. Clicking the header opens it.
 *
 * "Change type" never coerces a value between kinds — a value written under another kind is
 * cloaked (the server decodes it as empty, storage untouched) until the kind matches it
 * again, then it reappears exactly as it was.
 */
import { useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowLeftToLine, ArrowRightToLine, ArrowUp, Check, Copy, EyeOff, ListFilter, ListPlus,
  Pin, Repeat2, Rows3, Sigma, Trash2, WrapText, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { OPTION_CHIP_CLASS } from '@/lib/fieldValues';
import { FIELD_KIND_LABELS, OPTION_COLORS, type FieldDef, type FieldKind } from '@/types/fields';

export interface CalcOption { key: string; label: string; numberOnly?: boolean }

interface ColumnMenuProps {
  field: FieldDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kindIcon: Record<FieldKind, typeof Check>;
  kinds: readonly FieldKind[];
  calcOptions: readonly CalcOption[];
  calc: string;
  sortDir: 1 | -1 | null;
  grouped: boolean;
  frozen: boolean;
  wrapped: boolean;
  /** How many records use an option (for the remove guard). */
  optionUsage: (optionId: string) => number;
  onRename: (name: string) => void;
  onChangeKind: (kind: FieldKind) => void;
  onChangeOptions: (options: FieldDef['options']) => void;
  onFilter: () => void;
  onSort: (dir: 1 | -1) => void;
  onGroup: () => void;
  onCalc: (key: string) => void;
  onFreeze: () => void;
  onHide: () => void;
  onWrap: () => void;
  onInsertLeft: () => void;
  onInsertRight: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** The element the menu hangs from — the invisible cover over the header. */
  trigger: ReactNode;
}

const ROW_RIGHT = 'text-[13px] text-a-faint';
/** A side panel's caption row (showcase 665–667): 12px tertiary. */
const CAPTION = 'px-2 py-1.5 text-[12px] text-a-faint';

function Row({ icon: Icon, label, right, children }: { icon?: typeof Check; label: string; right?: string; children?: ReactNode }) {
  return (
    <>
      {Icon && <Icon className="size-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />}
      <span className="flex-1">{label}</span>
      {right && <span className={ROW_RIGHT}>{right}</span>}
      {children}
    </>
  );
}

function SwitchRow({ on }: { on: boolean }) {
  return <Switch size="sm" checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />;
}

export function ColumnMenu(p: ColumnMenuProps) {
  const { field } = p;
  const [confirm, setConfirm] = useState(false);
  const calcLabel = p.calcOptions.find((o) => o.key === p.calc)?.label ?? 'None';
  const hasOptions = field.kind === 'select' || field.kind === 'multi';
  // The prototype hangs every side panel from the menu's top edge (showcase 665, 681, 690),
  // not from the row that opened it: offset each by that row's distance from the top.
  const ROW = 30;
  const typeTop = 43;
  const optionsTop = typeTop + ROW;
  const calcTop = typeTop + ROW * (hasOptions ? 2 : 1) + 9 + ROW * 4;

  return (
    <DropdownMenu
      open={p.open}
      onOpenChange={(o) => { p.onOpenChange(o); if (!o) setConfirm(false); }}
    >
      <DropdownMenuTrigger asChild>{p.trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        alignOffset={-13}
        role="menu"
        aria-label="Property"
        className="max-h-[70vh] w-[260px]"
        // Some items open another popover; without this Radix hands focus back to the trigger
        // after the menu's close animation, which reads as focus leaving that popover.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-0.5 pb-1.5">
          <input
            defaultValue={field.name}
            key={field.name}
            aria-label="Property name"
            maxLength={100}
            onKeyDown={(e) => {
              e.stopPropagation(); // Radix typeahead would otherwise eat the letters
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { e.currentTarget.value = field.name; e.currentTarget.blur(); }
            }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== field.name) p.onRename(v); else e.target.value = field.name; }}
            className="h-[30px] w-full rounded-[4px] border border-a-line bg-a-surface px-2 text-[14px] text-a-ink outline-none focus-visible:border-a-accent"
          />
        </div>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Row icon={Repeat2} label="Change type" right={FIELD_KIND_LABELS[field.kind]} />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent role="menu" aria-label="Property type" alignOffset={-typeTop} sideOffset={10} className="max-h-[420px] w-[230px] overflow-auto">
            <div className={CAPTION}>Change type</div>
            {p.kinds.map((kind) => {
              const Icon = p.kindIcon[kind];
              return (
                <DropdownMenuItem key={kind} onClick={() => p.onChangeKind(kind)} className={cn(kind === field.kind && 'bg-a-line-soft')}>
                  <Icon className="size-4 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="flex-1">{FIELD_KIND_LABELS[kind]}</span>
                  {kind === field.kind && <Check className="size-[15px] text-a-accent" strokeWidth={1.75} aria-hidden />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {hasOptions && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Row icon={ListPlus} label="Edit options" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent role="dialog" aria-label="Edit options" alignOffset={-optionsTop} sideOffset={10} className="max-h-[420px] w-[280px] overflow-auto">
              <OptionsEditor field={field} usage={p.optionUsage} onChange={p.onChangeOptions} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={p.onFilter}><Row icon={ListFilter} label="Filter" /></DropdownMenuItem>
        <DropdownMenuItem onClick={() => p.onSort(1)} className={cn(p.sortDir === 1 && 'bg-a-line-soft')}><Row icon={ArrowUp} label="Sort ascending" /></DropdownMenuItem>
        <DropdownMenuItem onClick={() => p.onSort(-1)} className={cn(p.sortDir === -1 && 'bg-a-line-soft')}><Row icon={ArrowDown} label="Sort descending" /></DropdownMenuItem>
        <DropdownMenuItem onClick={p.onGroup}><Row icon={Rows3} label="Group" right={p.grouped ? 'On' : ''} /></DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Row icon={Sigma} label="Calculate" right={calcLabel === 'None' ? '' : calcLabel} />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent role="menu" aria-label="Calculate" alignOffset={-calcTop} sideOffset={10} className="w-[220px]">
            <div className={CAPTION}>Calculate</div>
            {p.calcOptions.filter((o) => !o.numberOnly || field.kind === 'number').map((o) => (
              <DropdownMenuItem key={o.key} onClick={() => p.onCalc(o.key)} className={cn(o.label === calcLabel && 'bg-a-line-soft')}>
                <span className="flex-1">{o.label}</span>
                {o.label === calcLabel && <Check className="size-[15px] text-a-accent" strokeWidth={1.75} aria-hidden />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); p.onFreeze(); }}>
          <Row icon={Pin} label="Freeze"><SwitchRow on={p.frozen} /></Row>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={p.onHide}><Row icon={EyeOff} label="Hide" /></DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); p.onWrap(); }}>
          <Row icon={WrapText} label="Wrap content"><SwitchRow on={p.wrapped} /></Row>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={p.onInsertLeft}><Row icon={ArrowLeftToLine} label="Insert left" /></DropdownMenuItem>
        <DropdownMenuItem onClick={p.onInsertRight}><Row icon={ArrowRightToLine} label="Insert right" /></DropdownMenuItem>
        <DropdownMenuItem onClick={p.onDuplicate}><Row icon={Copy} label="Duplicate property" /></DropdownMenuItem>
        {/* Deleting a column deletes its values in every record, so it asks once more. */}
        {confirm ? (
          <DropdownMenuItem variant="destructive" onClick={p.onDelete}><Row icon={Trash2} label="Delete from every record" /></DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={(e) => { e.preventDefault(); setConfirm(true); }}>
            <Row icon={Trash2} label="Delete property" />
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Edit options (showcase 681–693): a swatch that cycles the colour, the name, a remove button,
 * and an "Add an option" field. Edits apply at once; removing an option a record uses asks
 * first, because it clears that value from those records.
 */
function OptionsEditor({ field, usage, onChange }: { field: FieldDef; usage: (id: string) => number; onChange: (options: FieldDef['options']) => void }) {
  const [newLabel, setNewLabel] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  return (
    <div>
      <div className={CAPTION}>Options</div>
      {field.options.map((o) => {
        const used = usage(o.id);
        return (
          <div key={o.id} className="flex items-center gap-1.5 px-1 py-[3px]">
            <button
              type="button"
              aria-label="Change colour"
              title="Click to change colour"
              onClick={() => onChange(field.options.map((x) => (x.id === o.id ? { ...x, color: OPTION_COLORS[(OPTION_COLORS.indexOf(x.color) + 1) % OPTION_COLORS.length] } : x)))}
              className={cn('size-[22px] flex-shrink-0 rounded-[3px] border border-[rgba(15,15,15,0.08)]', OPTION_CHIP_CLASS[o.color])}
            />
            <input
              defaultValue={o.label}
              key={o.label}
              aria-label="Option name"
              maxLength={60}
              onKeyDown={(e) => { stop(e); if (e.key === 'Enter') e.currentTarget.blur(); }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== o.label) onChange(field.options.map((x) => (x.id === o.id ? { ...x, label: v } : x))); else e.target.value = o.label; }}
              className="h-7 min-w-0 flex-1 rounded-[4px] border border-a-line bg-a-surface px-2 text-[14px] text-a-ink outline-none focus-visible:border-a-accent"
            />
            {confirmId === o.id ? (
              <button
                type="button"
                onClick={() => { onChange(field.options.filter((x) => x.id !== o.id)); setConfirmId(null); }}
                className="h-7 flex-shrink-0 rounded-[3px] px-2 text-[12px] font-semibold text-q-do hover:bg-a-line-soft"
              >
                Remove from {used}?
              </button>
            ) : (
              <button
                type="button"
                aria-label="Remove option"
                onClick={() => (used > 0 ? setConfirmId(o.id) : onChange(field.options.filter((x) => x.id !== o.id)))}
                className="flex size-7 flex-shrink-0 items-center justify-center rounded-[4px] text-a-muted hover:bg-a-line-soft hover:text-a-ink"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            )}
          </div>
        );
      })}
      <div className="px-1 pt-1.5 pb-0.5">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            stop(e);
            if (e.key === 'Enter' && newLabel.trim()) {
              onChange([...field.options, { id: '', label: newLabel.trim(), color: OPTION_COLORS[field.options.length % OPTION_COLORS.length] }]);
              setNewLabel('');
            }
          }}
          placeholder="Add an option, then press Enter"
          aria-label="Add an option"
          maxLength={60}
          className="h-[30px] w-full rounded-[4px] border border-a-line bg-a-surface px-2 text-[14px] text-a-ink outline-none placeholder:text-a-faint focus-visible:border-a-accent"
        />
      </div>
    </div>
  );
}
