import { describe, expect, it } from 'vitest';
import {
  RULE_TEMPLATES, describeAction, describeCondition, describeSpec, describeTrigger, emptySpec, previewTemplate, validateSpec,
  type RuleSpec,
} from '@/lib/automationSpec';

describe('automation rule shape', () => {
  it('every starting template is a rule that can be saved as it is', () => {
    for (const template of RULE_TEMPLATES) {
      const { name, spec } = template.build();
      expect(name.length, template.id).toBeGreaterThan(0);
      expect(validateSpec(spec), template.id).toEqual([]);
      expect(spec.version).toBe(2);
    }
    expect(RULE_TEMPLATES.filter((t) => t.usesCliq).every((t) => t.build().spec.actions.some((a) => a.kind === 'notify-cliq'))).toBe(true);
  });

  it('the weekly update reminder is every Monday morning and catches up a late start', () => {
    const { spec } = RULE_TEMPLATES.find((t) => t.id === 'weekly-update')!.build();
    expect(describeTrigger(spec.triggers[0])).toBe('Every Monday at 09:30');
    expect(spec.options.catchUp).toBe(true);
    expect(spec.actions.every((a) => a.kind !== 'notify-cliq')).toBe(true);
  });

  it('says what a rule does in plain words', () => {
    const spec: RuleSpec = {
      ...emptySpec(),
      triggers: [
        { kind: 'date-reached', field: 'dueDate', offsets: [0, -60] },
        { kind: 'every', frequency: 'weekly', time: '09:00', dayOfWeek: 1, dayOfMonth: 1, digest: true },
      ],
      conditions: [{ field: 'category', op: 'is', value: 'Work' }, { field: 'note', op: 'is-empty', value: '' }],
      actions: [{ kind: 'notify-in-app' }, { kind: 'notify-cliq', combine: true }, { kind: 'set-status', status: 'DONE' }],
    };
    const words = describeSpec(spec);
    expect(words.when).toBe('A task’s due date: 1 hour before it is due, when it is due; or Every Monday at 09:00 (a summary of what is due)');
    expect(words.only).toEqual(['Category is “Work”', 'Note is empty']);
    expect(words.then).toEqual(['Notify me in HitList', 'Message me on Cliq (one message for several tasks)', 'Set the status to done']);
    expect(describeTrigger({ kind: 'status-becomes', status: 'DONE' })).toBe('A task becomes done');
    expect(describeCondition({ field: 'dueDate', op: 'before', value: '2030-01-01' })).toBe('Due date is before “2030-01-01”');
    expect(describeAction({ kind: 'notify-cliq', combine: false })).toBe('Message me on Cliq');
  });

  it('finds what is wrong before saving', () => {
    const base = emptySpec();
    expect(validateSpec({ ...base, triggers: [] })).toContain('Choose what starts the rule.');
    expect(validateSpec({ ...base, actions: [] })).toContain('Choose what the rule does.');
    expect(validateSpec({ ...base, triggers: [{ kind: 'date-reached', field: 'dueDate', offsets: [] }] })).toContain('Add at least one moment for the due date.');
    expect(validateSpec({ ...base, triggers: [{ kind: 'every', frequency: 'daily', time: '9am', dayOfWeek: 1, dayOfMonth: 1 }] })).toContain('Write the time as HH:MM, for example 09:00.');
    expect(validateSpec({ ...base, conditions: [{ field: 'title', op: 'contains', value: ' ' }] }).join(' ')).toContain('Give a value');
    expect(validateSpec({ ...base, conditions: [{ field: 'title', op: 'is-set', value: '' }] })).toEqual([]);
    expect(validateSpec({ ...base, actions: [{ kind: 'notify-cliq', quietFrom: '22:00' }] })).toContain('Quiet hours need both a start and an end, or neither.');
    expect(validateSpec({ ...base, actions: [{ kind: 'notify-in-app' }, { kind: 'notify-in-app' }] })).toContain('Each action can be used once.');
    expect(validateSpec({ ...base, actions: [{ kind: 'notify-in-app', template: 'x'.repeat(501) }] }).join(' ')).toContain('at most 500');
  });

  it('shows a sample of the message with the words filled in', () => {
    expect(previewTemplate('', 'Nudge')).toBe('🔔 Send the quarterly report — Due in 30 minutes\n   ↳ asked @mandy, still open');
    expect(previewTemplate('{{title}}: {{note}}', 'Nudge')).toBe('Send the quarterly report: asked @mandy, still open');
    expect(previewTemplate('{{rule}}: {{title}} ({{list}}, {{status}}) {{count}}', 'Nudge')).toBe('Nudge: Send the quarterly report (Work, To do) 3');
  });
});
