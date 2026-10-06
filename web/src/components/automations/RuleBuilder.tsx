/**
 * The rule builder: Notion-style "when → only if → then". Pick what starts the rule, what must be true, and what it does,
 * including "Notify me via the Cliq bot" with its message, quiet hours and daily limit. Every rule opens here, old or new,
 * because the server returns each rule in the same shape (see lib/automationSpec.ts).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ReminderStepList } from '@/components/automations/ReminderStepList';
import { normaliseSteps } from '@/lib/reminderSteps';
import {
  ACTION_LABELS, DAY_NAMES, FIELD_LABELS, MAX_ACTIONS, MAX_CONDITIONS, MAX_TEMPLATE, MAX_TRIGGERS, OPS_WITHOUT_VALUE, OP_LABELS,
  STATUS_LABELS, TEMPLATE_TOKENS, TRIGGER_LABELS, defaultAction, defaultTrigger, previewTemplate, validateSpec,
  type Action, type ActionKind, type Condition, type ConditionOp, type RecurrenceFrequency, type RuleSpec, type TaskField,
  type TaskStatusValue, type Trigger, type TriggerKind,
} from '@/lib/automationSpec';
import type { AutomationRuleInput } from '@/lib/api';
import type { AutomationRule, AutomationStatus } from '@/types/automation';
import { cn } from '@/lib/utils';

const PRIMARY = 'h-[34px] rounded-[4px] bg-a-accent px-4 text-[13px] font-semibold text-white transition-colors duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY = 'h-[34px] rounded-[4px] border border-a-line-strong bg-a-surface px-4 text-[13px] font-semibold text-a-ink transition-colors duration-[120ms] hover:bg-a-bg disabled:cursor-not-allowed disabled:opacity-50';
const LINK = 'text-[12px] font-semibold text-a-accent-700 hover:underline disabled:opacity-50';
const NATIVE = 'h-[34px] rounded-[3px] border border-a-line-strong bg-a-surface px-2 text-[13px] text-a-ink';

const TRIGGER_KINDS = Object.keys(TRIGGER_LABELS) as TriggerKind[];
const ACTION_KINDS = Object.keys(ACTION_LABELS) as ActionKind[];
const FIELDS = Object.keys(FIELD_LABELS) as TaskField[];
const OPS = Object.keys(OP_LABELS) as ConditionOp[];
const STATUSES = Object.keys(STATUS_LABELS) as TaskStatusValue[];
const CATCH_UP: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'Not at all' },
  { minutes: 120, label: 'Up to 2 hours old' },
  { minutes: 1440, label: 'Up to a day old' },
  { minutes: 10080, label: 'Up to a week old' },
];

export interface RuleBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rule being edited, or null for a new one. */
  rule: AutomationRule | null;
  /** A new rule's starting point (a template, or a task's reminder). Ignored when editing. */
  start: { name: string; spec: RuleSpec } | null;
  /** Where the rule can look: this account's own tasks, and each shared workspace on this computer. */
  workspaces: ReadonlyArray<{ id: string; name: string }>;
  /** The Cliq address saved in Account → Cliq alerts, or null when there is none (or this is not the desktop app). */
  cliqEmail: string | null;
  cliqAvailable: boolean;
  /** The task a rule is limited to, shown by name. */
  subjectTitle?: string;
  onSave: (input: AutomationRuleInput) => Promise<boolean>;
  /** Sends one test message to the saved Cliq address; resolves a short code ('sent', 'offline', ...). */
  onSendTest?: (text: string) => Promise<string>;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-[8px] border border-a-line p-4" aria-label={title}>
      <div>
        <h3 className="text-[14px] font-semibold text-a-ink">{title}</h3>
        {hint && <p className="text-[12px] text-a-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const TEST_RESULT: Record<string, string> = {
  sent: 'Sent. Look for a message from the HitList bot in Cliq.',
  'bad-email': 'Save your Cliq email first (Account menu, Cliq alerts).',
  offline: 'Could not reach the server. Try again when you are online.',
  'sign-in-needed': 'Sign in to HitList first (Account menu).',
  'signed-out': 'Sign in to HitList first (Account menu).',
  'not-configured': 'The Cliq connection is not set up on the server yet.',
};

export function RuleBuilder({ open, onOpenChange, rule, start, workspaces, cliqEmail, cliqAvailable, subjectTitle, onSave, onSendTest }: RuleBuilderProps) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<AutomationStatus>('active');
  const [spec, setSpec] = useState<RuleSpec | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the rule (or the starting point) each time the builder opens.
  useEffect(() => {
    if (!open) return;
    setProblems([]); setTestNote(null); setSaveError(null); setSaving(false);
    if (rule?.spec) {
      setName(rule.name); setStatus(rule.status); setSpec(structuredClone(rule.spec));
    } else if (start) {
      setName(start.name); setStatus('active'); setSpec(structuredClone(start.spec));
    }
  }, [open, rule, start]);

  const patch = (next: Partial<RuleSpec>) => setSpec((cur) => (cur ? { ...cur, ...next } : cur));
  const itemTriggers = useMemo(() => !!spec && spec.triggers.some((t) => t.kind !== 'every' && t.kind !== 'manual'), [spec]);

  if (!spec) return null;

  const setTrigger = (index: number, next: Trigger) => patch({ triggers: spec.triggers.map((t, i) => (i === index ? next : t)) });
  const setAction = (index: number, next: Action) => patch({ actions: spec.actions.map((a, i) => (i === index ? next : a)) });
  const setCondition = (index: number, next: Condition) => patch({ conditions: spec.conditions.map((c, i) => (i === index ? next : c)) });

  const save = async () => {
    const found = validateSpec(spec);
    if (!name.trim()) found.unshift('Give the rule a name.');
    setProblems(found);
    if (found.length) return;
    setSaving(true);
    setSaveError(null);
    const input: AutomationRuleInput = {
      name: name.trim(),
      taskId: spec.subjectId || undefined,
      triggerType: 'custom',
      status,
      urgency: 'medium',
      offsetMinutes: [],
      notifyInApp: spec.actions.some((a) => a.kind === 'notify-in-app'),
      notifyBrowser: spec.actions.some((a) => a.kind === 'notify-browser'),
      notifyEmail: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      spec,
    };
    try {
      const ok = await onSave(input);
      if (ok) onOpenChange(false); else setSaveError('The rule could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const cliqAction = spec.actions.find((a) => a.kind === 'notify-cliq');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b border-a-line px-6 py-4 text-left">
          <DialogTitle>{rule ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>Choose what starts the rule, what must be true, and what it does.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          <div className="flex items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="rule-name" className="text-[13px] text-a-muted">Name</Label>
              <Input id="rule-name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-status" className="text-[13px] text-a-muted">Status</Label>
              <select id="rule-status" value={status} onChange={(e) => setStatus(e.target.value as AutomationStatus)} className={NATIVE}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[13px] text-a-muted">
            <label className="flex items-center gap-2">
              <span>Looks at</span>
              <select aria-label="Which tasks" value={spec.scope} onChange={(e) => patch({ scope: e.target.value })} className={NATIVE}>
                <option value="personal">My own tasks</option>
                {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} (shared)</option>)}
              </select>
            </label>
            {spec.subjectId && (
              <span className="flex items-center gap-1.5 rounded-[4px] border border-a-line px-2 py-1 text-[12px] text-a-ink">
                Only {subjectTitle ? `“${subjectTitle}”` : 'one task'}
                <button type="button" aria-label="Look at every task instead" onClick={() => patch({ subjectId: '' })} className="text-a-faint hover:text-a-ink">
                  <X className="size-3" strokeWidth={1.75} aria-hidden />
                </button>
              </span>
            )}
          </div>

          <Section title="When" hint="The rule starts when any of these happens.">
            {spec.triggers.map((trigger, index) => (
              <TriggerEditor
                key={index}
                trigger={trigger}
                canRemove={spec.triggers.length > 1}
                onChange={(next) => setTrigger(index, next)}
                onRemove={() => patch({ triggers: spec.triggers.filter((_, i) => i !== index) })}
              />
            ))}
            {spec.triggers.length < MAX_TRIGGERS && (
              <select
                aria-label="Add another trigger"
                value=""
                onChange={(e) => { if (e.target.value) patch({ triggers: [...spec.triggers, defaultTrigger(e.target.value as TriggerKind)] }); }}
                className={cn(NATIVE, 'self-start text-a-accent-700')}
              >
                <option value="">+ Add another trigger</option>
                {TRIGGER_KINDS.map((kind) => <option key={kind} value={kind}>{TRIGGER_LABELS[kind]}</option>)}
              </select>
            )}
          </Section>

          <Section title="Only if" hint={itemTriggers ? 'Every condition must be true of the task, as it is when the rule runs.' : 'Conditions look at a task; a schedule has no task, so they are not used here.'}>
            {spec.conditions.map((condition, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2" role="group" aria-label={`Condition ${index + 1}`}>
                <select aria-label="Field" value={condition.field} onChange={(e) => setCondition(index, { ...condition, field: e.target.value as TaskField })} className={NATIVE}>
                  {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                </select>
                <select aria-label="Is" value={condition.op} onChange={(e) => setCondition(index, { ...condition, op: e.target.value as ConditionOp })} className={NATIVE}>
                  {OPS.map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
                </select>
                {!OPS_WITHOUT_VALUE.has(condition.op) && (
                  <Input aria-label="Value" className="h-[34px] w-[160px]" value={condition.value} maxLength={200} onChange={(e) => setCondition(index, { ...condition, value: e.target.value })} />
                )}
                <button type="button" aria-label={`Remove condition ${index + 1}`} onClick={() => patch({ conditions: spec.conditions.filter((_, i) => i !== index) })} className="text-a-faint hover:text-a-ink">
                  <X className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            ))}
            {spec.conditions.length < MAX_CONDITIONS && (
              <button type="button" className={cn(LINK, 'flex items-center gap-1 self-start')} onClick={() => patch({ conditions: [...spec.conditions, { field: 'status', op: 'is-not', value: 'DONE' }] })}>
                <Plus className="size-3" strokeWidth={1.75} aria-hidden /> Add a condition
              </button>
            )}
          </Section>

          <Section title="Then" hint="These run in order each time the rule runs.">
            {spec.actions.map((action, index) => (
              <ActionEditor
                key={action.kind}
                action={action}
                ruleName={name}
                cliqEmail={cliqEmail}
                cliqAvailable={cliqAvailable}
                canRemove={spec.actions.length > 1}
                onChange={(next) => setAction(index, next)}
                onRemove={() => patch({ actions: spec.actions.filter((_, i) => i !== index) })}
                onSendTest={onSendTest ? async (text) => { const code = await onSendTest(text); setTestNote(TEST_RESULT[code] ?? 'That did not work. Try again in a moment.'); } : undefined}
                testNote={action.kind === 'notify-cliq' ? testNote : null}
              />
            ))}
            {spec.actions.length < MAX_ACTIONS && (
              <select
                aria-label="Add another action"
                value=""
                onChange={(e) => { if (e.target.value) patch({ actions: [...spec.actions, defaultAction(e.target.value as ActionKind)] }); }}
                className={cn(NATIVE, 'self-start text-a-accent-700')}
              >
                <option value="">+ Add another action</option>
                {ACTION_KINDS.filter((k) => !spec.actions.some((a) => a.kind === k)).map((kind) => <option key={kind} value={kind}>{ACTION_LABELS[kind]}</option>)}
              </select>
            )}
          </Section>

          <Section title="If HitList was closed">
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-a-muted">
              <label className="flex items-center gap-2">
                <span>Still run moments that were missed</span>
                <select
                  aria-label="Catch up"
                  value={String(spec.options.catchUpMinutes)}
                  onChange={(e) => patch({ options: { ...spec.options, catchUpMinutes: Number(e.target.value) } })}
                  className={NATIVE}
                >
                  {CATCH_UP.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2.5 text-[13px] text-a-ink">
              <Switch aria-label="Include tasks that are already due" checked={spec.options.catchUp} onCheckedChange={(on) => patch({ options: { ...spec.options, catchUp: on } })} />
              Also run for what is already due when I save this rule
            </label>
            <p className="text-[12px] text-a-faint">Rules only run while HitList is open. Anything older than this is not run late; it is listed once as missed.</p>
          </Section>

          {cliqAction && cliqAvailable && !cliqEmail && (
            <p role="status" className="rounded-[4px] border border-a-amber-line bg-a-amber-tint px-3 py-2 text-[13px] text-a-amber-ink">
              The Cliq action needs your Cliq email. Add it in the Account menu under Cliq alerts, then messages will be delivered.
            </p>
          )}
          {cliqAction && !cliqAvailable && (
            <p role="status" className="rounded-[4px] border border-a-amber-line bg-a-amber-tint px-3 py-2 text-[13px] text-a-amber-ink">
              Cliq messages are sent by the HitList desktop app. This rule is saved, but nothing is sent from a browser.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-a-line px-6 py-4">
          {problems.length > 0 && (
            <ul role="alert" className="list-disc pl-5 text-[13px] text-a-attention">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {saveError && <p role="alert" className="text-[13px] text-a-attention">{saveError}</p>}
          <div className="flex items-center justify-end gap-3">
            <button type="button" className={SECONDARY} onClick={() => onOpenChange(false)}>Cancel</button>
            <button type="button" className={PRIMARY} disabled={saving} onClick={() => { void save(); }}>{rule ? 'Save changes' : 'Create rule'}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── one trigger ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function TriggerEditor({ trigger, canRemove, onChange, onRemove }: {
  trigger: Trigger; canRemove: boolean; onChange: (next: Trigger) => void; onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[6px] bg-a-bg p-3" role="group" aria-label={`Trigger: ${TRIGGER_LABELS[trigger.kind]}`}>
      <div className="flex items-center gap-2">
        <Select value={trigger.kind} onValueChange={(kind) => onChange(defaultTrigger(kind as TriggerKind))}>
          <SelectTrigger className="h-[34px] flex-1" aria-label="Trigger"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRIGGER_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{TRIGGER_LABELS[kind]}</SelectItem>)}
          </SelectContent>
        </Select>
        {canRemove && (
          <button type="button" aria-label="Remove this trigger" onClick={onRemove} className="text-a-faint hover:text-a-ink">
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      {trigger.kind === 'date-reached' && (
        <ReminderStepList steps={trigger.offsets} onChange={(offsets) => onChange({ ...trigger, offsets: normaliseSteps(offsets) })} />
      )}

      {trigger.kind === 'every' && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-a-muted">
          <select aria-label="How often" value={trigger.frequency} onChange={(e) => onChange({ ...trigger, frequency: e.target.value as RecurrenceFrequency })} className={NATIVE}>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
          {trigger.frequency === 'weekly' && (
            <select aria-label="Day of the week" value={trigger.dayOfWeek} onChange={(e) => onChange({ ...trigger, dayOfWeek: Number(e.target.value) })} className={NATIVE}>
              {DAY_NAMES.map((day, i) => <option key={day} value={i}>{day}</option>)}
            </select>
          )}
          {trigger.frequency === 'monthly' && (
            <label className="flex items-center gap-1.5">
              on day
              <Input aria-label="Day of the month" type="number" min={1} max={31} className="h-[34px] w-[70px]" value={trigger.dayOfMonth}
                onChange={(e) => onChange({ ...trigger, dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
          )}
          <label className="flex items-center gap-1.5">
            at
            <input aria-label="Time" type="time" value={trigger.time} onChange={(e) => onChange({ ...trigger, time: e.target.value })} className={NATIVE} />
          </label>
          <label className="flex items-center gap-2 text-a-ink">
            <Switch aria-label="Send a summary" checked={!!trigger.digest} onCheckedChange={(on) => onChange({ ...trigger, digest: on })} />
            A summary of what is due
          </label>
        </div>
      )}

      {trigger.kind === 'field-edited' && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
          <legend className="mb-1 text-[12px] text-a-faint">Starts when any of these change</legend>
          {FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-1.5 text-[13px] text-a-ink">
              <input
                type="checkbox"
                checked={trigger.watch.includes(field)}
                onChange={(e) => onChange({ ...trigger, watch: e.target.checked ? [...trigger.watch, field] : trigger.watch.filter((f) => f !== field) })}
              />
              {FIELD_LABELS[field]}
            </label>
          ))}
        </fieldset>
      )}

      {trigger.kind === 'status-becomes' && (
        <select aria-label="Becomes" value={trigger.status} onChange={(e) => onChange({ ...trigger, status: e.target.value as TaskStatusValue })} className={cn(NATIVE, 'self-start')}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      )}

      {trigger.kind === 'item-added' && <p className="text-[12px] text-a-faint">Checked about once a minute while HitList is open.</p>}
      {trigger.kind === 'manual' && <p className="text-[12px] text-a-faint">It only runs when you press Run now on the rule.</p>}
    </div>
  );
}

// ── one action ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function ActionEditor({ action, ruleName, cliqEmail, cliqAvailable, canRemove, onChange, onRemove, onSendTest, testNote }: {
  action: Action; ruleName: string; cliqEmail: string | null; cliqAvailable: boolean; canRemove: boolean;
  onChange: (next: Action) => void; onRemove: () => void;
  onSendTest?: (text: string) => Promise<void>; testNote: string | null;
}) {
  const [testing, setTesting] = useState(false);
  const template = 'template' in action ? action.template ?? '' : '';
  const setTemplate = (text: string) => onChange({ ...action, template: text } as Action);
  const isMessage = action.kind === 'notify-in-app' || action.kind === 'notify-browser' || action.kind === 'notify-cliq';

  return (
    <div className="flex flex-col gap-2.5 rounded-[6px] bg-a-bg p-3" role="group" aria-label={`Action: ${ACTION_LABELS[action.kind]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-a-ink">{ACTION_LABELS[action.kind]}</span>
        {canRemove && (
          <button type="button" aria-label={`Remove ${ACTION_LABELS[action.kind]}`} onClick={onRemove} className="text-a-faint hover:text-a-ink">
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      {action.kind === 'notify-cliq' && cliqAvailable && (
        <p className="text-[12px] text-a-faint">
          {cliqEmail ? `Goes to ${cliqEmail} from the HitList bot.` : 'Needs your Cliq email (Account menu, Cliq alerts).'} Sent while HitList is open and you are signed in.
        </p>
      )}

      {isMessage && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`msg-${action.kind}`} className="text-[12px] text-a-muted">Message (optional)</Label>
          <Textarea
            id={`msg-${action.kind}`}
            value={template}
            maxLength={MAX_TEMPLATE}
            rows={2}
            placeholder={action.kind === 'notify-cliq' ? '🔔 {{title}} — {{when}}' : 'Leave empty for the standard text'}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5" aria-label="Words you can use">
            {TEMPLATE_TOKENS.map((t) => (
              <button
                key={t.token}
                type="button"
                title={t.hint}
                onClick={() => setTemplate(`${template}${template && !template.endsWith(' ') ? ' ' : ''}${t.token}`)}
                className="rounded-[3px] border border-a-line bg-a-surface px-1.5 py-0.5 font-mono text-[11px] text-a-muted hover:text-a-ink"
              >
                {t.token}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-a-faint" aria-label="Preview">Preview: {previewTemplate(template, ruleName)}</p>
        </div>
      )}

      {action.kind === 'notify-cliq' && (
        <>
          <label className="flex items-center gap-2.5 text-[13px] text-a-ink">
            <Switch aria-label="One message for several tasks" checked={action.combine !== false} onCheckedChange={(on) => onChange({ ...action, combine: on })} />
            One message when several tasks run together (lists up to 10)
          </label>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-a-muted">
            <span>Quiet hours</span>
            <input aria-label="Quiet from" type="time" value={action.quietFrom ?? ''} onChange={(e) => onChange({ ...action, quietFrom: e.target.value || undefined })} className={NATIVE} />
            <span>to</span>
            <input aria-label="Quiet until" type="time" value={action.quietTo ?? ''} onChange={(e) => onChange({ ...action, quietTo: e.target.value || undefined })} className={NATIVE} />
            {(action.quietFrom || action.quietTo) && (
              <button type="button" className={LINK} onClick={() => onChange({ ...action, quietFrom: undefined, quietTo: undefined })}>Clear</button>
            )}
            <span className="text-[12px] text-a-faint">Messages wait until quiet hours end.</span>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-a-muted">
            At most
            <Input aria-label="Messages a day" type="number" min={1} max={500} className="h-[34px] w-[80px]" value={action.dailyCap ?? 30}
              onChange={(e) => onChange({ ...action, dailyCap: Math.min(500, Math.max(1, Number(e.target.value) || 1)) })} />
            messages a day from this rule
          </label>
          {onSendTest && cliqAvailable && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={SECONDARY}
                disabled={testing || !cliqEmail}
                onClick={() => { setTesting(true); void onSendTest(previewTemplate(template, ruleName)).finally(() => setTesting(false)); }}
              >
                Send a test with this message
              </button>
              {testNote && <span role="status" className="text-[13px] text-a-muted">{testNote}</span>}
            </div>
          )}
        </>
      )}

      {action.kind === 'set-status' && (
        <select aria-label="New status" value={action.status} onChange={(e) => onChange({ ...action, status: e.target.value as TaskStatusValue })} className={cn(NATIVE, 'self-start')}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      )}
    </div>
  );
}
