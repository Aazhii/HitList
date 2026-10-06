/**
 * The shape of an automation rule (version 2) as the app edits it: where it looks, what starts it, what must be true, and what it
 * does. The server stores and checks the same shape (`AutomationSpecs.java`); every rule the server returns carries one, even a
 * rule saved before this existed, so the builder edits all rules the same way.
 */
import { humanDuration } from '@/lib/reminderSteps';

export type RecurrenceFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';
export type TaskStatusValue = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskField = 'title' | 'status' | 'quadrant' | 'listId' | 'category' | 'dueDate' | 'dueTime' | 'note' | 'priority';
export type ConditionOp = 'is' | 'is-not' | 'contains' | 'starts-with' | 'is-empty' | 'is-set' | 'before' | 'after';

export type Trigger =
  | { kind: 'date-reached'; field: 'dueDate'; offsets: number[] }
  | { kind: 'every'; frequency: RecurrenceFrequency; time: string; dayOfWeek: number; dayOfMonth: number; digest?: boolean }
  | { kind: 'item-added' }
  | { kind: 'field-edited'; watch: TaskField[] }
  | { kind: 'status-becomes'; status: TaskStatusValue }
  | { kind: 'manual' };
export type TriggerKind = Trigger['kind'];

export interface Condition { field: TaskField; op: ConditionOp; value: string }

export type Action =
  | { kind: 'notify-in-app'; template?: string }
  | { kind: 'notify-browser'; template?: string }
  | { kind: 'notify-cliq'; template?: string; combine?: boolean; quietFrom?: string; quietTo?: string; dailyCap?: number }
  | { kind: 'set-status'; status: TaskStatusValue };
export type ActionKind = Action['kind'];

export interface RuleSpec {
  version: 2;
  source: 'tasks';
  /** 'personal' (this account's own tasks) or a shared workspace's id. */
  scope: string;
  /** One task only, or '' for all of them. */
  subjectId: string;
  triggers: Trigger[];
  conditions: Condition[];
  actions: Action[];
  options: { catchUpMinutes: number; catchUp: boolean };
}

export const MAX_TRIGGERS = 4;
export const MAX_CONDITIONS = 8;
export const MAX_ACTIONS = 5;
export const MAX_TEMPLATE = 500;

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  'date-reached': 'A due date is reached',
  every: 'Every day, week or month',
  'item-added': 'A task is added',
  'field-edited': 'A task is edited',
  'status-becomes': 'A task’s status becomes…',
  manual: 'I run it myself',
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  'notify-in-app': 'Notify me in HitList',
  'notify-browser': 'Show a desktop notification',
  'notify-cliq': 'Notify me via the Cliq bot',
  'set-status': 'Change the task’s status',
};

export const FIELD_LABELS: Record<TaskField, string> = {
  title: 'Title', status: 'Status', quadrant: 'Quadrant', listId: 'List', category: 'Category',
  dueDate: 'Due date', dueTime: 'Due time', note: 'Note', priority: 'Priority',
};

export const OP_LABELS: Record<ConditionOp, string> = {
  is: 'is', 'is-not': 'is not', contains: 'contains', 'starts-with': 'starts with',
  'is-empty': 'is empty', 'is-set': 'is set', before: 'is before', after: 'is after',
};

export const STATUS_LABELS: Record<TaskStatusValue, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The words a message can use, replaced with the task's own values when it is sent. */
export const TEMPLATE_TOKENS: ReadonlyArray<{ token: string; hint: string }> = [
  { token: '{{title}}', hint: 'the task’s title' },
  { token: '{{due}}', hint: 'its due date and time' },
  { token: '{{when}}', hint: 'for example "Due in 30 minutes"' },
  { token: '{{status}}', hint: 'To do, In progress or Done' },
  { token: '{{list}}', hint: 'the list it is in' },
  { token: '{{assignee}}', hint: 'who it is for (shared workspaces)' },
  { token: '{{rule}}', hint: 'this rule’s name' },
  { token: '{{count}}', hint: 'how many items, in a combined message' },
];

export const OPS_WITHOUT_VALUE: ReadonlySet<ConditionOp> = new Set(['is-empty', 'is-set']);

export function emptySpec(): RuleSpec {
  return {
    version: 2, source: 'tasks', scope: 'personal', subjectId: '',
    triggers: [{ kind: 'date-reached', field: 'dueDate', offsets: [0] }],
    conditions: [],
    actions: [{ kind: 'notify-in-app' }],
    options: { catchUpMinutes: 1440, catchUp: false },
  };
}

export function defaultTrigger(kind: TriggerKind): Trigger {
  switch (kind) {
    case 'date-reached': return { kind, field: 'dueDate', offsets: [0] };
    case 'every': return { kind, frequency: 'daily', time: '09:00', dayOfWeek: 1, dayOfMonth: 1 };
    case 'field-edited': return { kind, watch: ['status'] };
    case 'status-becomes': return { kind, status: 'DONE' };
    case 'item-added': return { kind };
    default: return { kind: 'manual' };
  }
}

export function defaultAction(kind: ActionKind): Action {
  switch (kind) {
    case 'notify-cliq': return { kind, combine: true, dailyCap: 30 };
    case 'set-status': return { kind, status: 'DONE' };
    default: return { kind } as Action;
  }
}

// ── in words ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function offsetWords(minutes: number): string {
  if (minutes === 0) return 'when it is due';
  return `${humanDuration(minutes)} ${minutes < 0 ? 'before' : 'after'} it is due`;
}

export function describeTrigger(trigger: Trigger): string {
  switch (trigger.kind) {
    case 'date-reached': {
      const steps = [...trigger.offsets].sort((a, b) => a - b).map(offsetWords);
      return `A task’s due date: ${steps.join(', ')}`;
    }
    case 'every': {
      const at = trigger.time;
      const how = trigger.frequency === 'weekly' ? `Every ${DAY_NAMES[trigger.dayOfWeek] ?? 'week'}`
        : trigger.frequency === 'monthly' ? `Monthly on day ${trigger.dayOfMonth}`
        : trigger.frequency === 'weekdays' ? 'Every weekday' : 'Every day';
      return `${how} at ${at}${trigger.digest ? ' (a summary of what is due)' : ''}`;
    }
    case 'item-added': return 'A task is added';
    case 'field-edited': return `A task’s ${trigger.watch.map((f) => FIELD_LABELS[f].toLowerCase()).join(' or ')} changes`;
    case 'status-becomes': return `A task becomes ${STATUS_LABELS[trigger.status].toLowerCase()}`;
    default: return 'You run it yourself';
  }
}

export function describeCondition(c: Condition): string {
  const op = OP_LABELS[c.op];
  return OPS_WITHOUT_VALUE.has(c.op) ? `${FIELD_LABELS[c.field]} ${op}` : `${FIELD_LABELS[c.field]} ${op} “${c.value}”`;
}

export function describeAction(a: Action): string {
  switch (a.kind) {
    case 'notify-in-app': return 'Notify me in HitList';
    case 'notify-browser': return 'Show a desktop notification';
    case 'notify-cliq': return `Message me on Cliq${a.combine === false ? '' : ' (one message for several tasks)'}`;
    default: return `Set the status to ${STATUS_LABELS[a.status].toLowerCase()}`;
  }
}

/** The whole rule as three short lines for a list row: when, only if, then. */
export function describeSpec(spec: RuleSpec): { when: string; only: string[]; then: string[] } {
  return {
    when: spec.triggers.map(describeTrigger).join('; or '),
    only: spec.conditions.map(describeCondition),
    then: spec.actions.map(describeAction),
  };
}

// ── checks ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What is wrong with a rule, in words, before it is sent. Empty means it can be saved. */
export function validateSpec(spec: RuleSpec): string[] {
  const problems: string[] = [];
  if (spec.triggers.length === 0) problems.push('Choose what starts the rule.');
  if (spec.actions.length === 0) problems.push('Choose what the rule does.');
  for (const t of spec.triggers) {
    if (t.kind === 'date-reached' && t.offsets.length === 0) problems.push('Add at least one moment for the due date.');
    if (t.kind === 'every' && !TIME.test(t.time)) problems.push('Write the time as HH:MM, for example 09:00.');
    if (t.kind === 'field-edited' && t.watch.length === 0) problems.push('Choose which field to watch.');
  }
  for (const c of spec.conditions) {
    if (!OPS_WITHOUT_VALUE.has(c.op) && c.value.trim() === '') problems.push(`Give a value for “${FIELD_LABELS[c.field]} ${OP_LABELS[c.op]}”, or remove that condition.`);
  }
  for (const a of spec.actions) {
    if ('template' in a && (a.template?.length ?? 0) > MAX_TEMPLATE) problems.push(`A message may be at most ${MAX_TEMPLATE} characters.`);
    if (a.kind === 'notify-cliq') {
      if ((a.quietFrom && !TIME.test(a.quietFrom)) || (a.quietTo && !TIME.test(a.quietTo))) problems.push('Write quiet hours as HH:MM.');
      if (!!a.quietFrom !== !!a.quietTo) problems.push('Quiet hours need both a start and an end, or neither.');
    }
  }
  const kinds = spec.actions.map((a) => a.kind);
  if (new Set(kinds).size !== kinds.length) problems.push('Each action can be used once.');
  return problems;
}

/** A sample of the message, with each token replaced by an example, for the preview under the message box. */
export function previewTemplate(template: string, ruleName: string): string {
  const text = template.trim() === '' ? '🔔 {{title}} — {{when}}' : template;
  return text
    .replace(/\{\{title\}\}/g, 'Send the quarterly report')
    .replace(/\{\{due\}\}/g, '2026-10-06 17:00')
    .replace(/\{\{when\}\}/g, 'Due in 30 minutes')
    .replace(/\{\{status\}\}/g, 'To do')
    .replace(/\{\{list\}\}/g, 'Work')
    .replace(/\{\{assignee\}\}/g, 'Alex')
    .replace(/\{\{rule\}\}/g, ruleName || 'My rule')
    .replace(/\{\{count\}\}/g, '3');
}

// ── starting points ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  /** Marks the ones that need the Cliq connection. */
  usesCliq: boolean;
  build: () => { name: string; spec: RuleSpec };
}

const withSpec = (patch: Partial<RuleSpec>): RuleSpec => ({ ...emptySpec(), ...patch });

export const RULE_TEMPLATES: ReadonlyArray<RuleTemplate> = [
  {
    id: 'overdue-cliq', usesCliq: true,
    name: 'Tell me on Cliq when a task is overdue',
    description: 'One bot message when tasks pass their due time. Tasks that became due together come in one message.',
    build: () => ({
      name: 'Overdue tasks on Cliq',
      spec: withSpec({
        triggers: [{ kind: 'date-reached', field: 'dueDate', offsets: [0] }],
        actions: [{ kind: 'notify-cliq', combine: true, dailyCap: 30 }],
      }),
    }),
  },
  {
    id: 'remind-before', usesCliq: false,
    name: 'Remind me before something is due',
    description: 'A notice an hour before and again five minutes before.',
    build: () => ({
      name: 'Remind me before it is due',
      spec: withSpec({
        triggers: [{ kind: 'date-reached', field: 'dueDate', offsets: [-60, -5] }],
        actions: [{ kind: 'notify-in-app' }, { kind: 'notify-browser' }],
      }),
    }),
  },
  {
    id: 'morning-digest-cliq', usesCliq: true,
    name: 'Weekday morning summary on Cliq',
    description: 'At 09:00 on weekdays: how many tasks are due today and how many are overdue.',
    build: () => ({
      name: 'Weekday morning summary',
      spec: withSpec({
        triggers: [{ kind: 'every', frequency: 'weekdays', time: '09:00', dayOfWeek: 1, dayOfMonth: 1, digest: true }],
        actions: [{ kind: 'notify-cliq', combine: true, dailyCap: 30 }],
      }),
    }),
  },
  {
    id: 'daily-digest', usesCliq: false,
    name: 'Daily summary in HitList',
    description: 'Every morning at 09:00, a notice with what is due today and what is overdue.',
    build: () => ({
      name: 'Daily summary',
      spec: withSpec({
        triggers: [{ kind: 'every', frequency: 'daily', time: '09:00', dayOfWeek: 1, dayOfMonth: 1, digest: true }],
        actions: [{ kind: 'notify-in-app' }],
      }),
    }),
  },
  {
    id: 'done-notice', usesCliq: false,
    name: 'When a task is done',
    description: 'A short notice each time a task is marked done.',
    build: () => ({
      name: 'Task done',
      spec: withSpec({ triggers: [{ kind: 'status-becomes', status: 'DONE' }], actions: [{ kind: 'notify-in-app' }] }),
    }),
  },
  {
    id: 'task-added', usesCliq: false,
    name: 'When a task is added',
    description: 'Useful in a shared workspace, to see what others add.',
    build: () => ({
      name: 'Task added',
      spec: withSpec({ triggers: [{ kind: 'item-added' }], actions: [{ kind: 'notify-in-app' }] }),
    }),
  },
  {
    id: 'blank', usesCliq: false,
    name: 'Start from scratch',
    description: 'Choose the trigger, conditions and actions yourself.',
    build: () => ({ name: 'New rule', spec: emptySpec() }),
  },
];
