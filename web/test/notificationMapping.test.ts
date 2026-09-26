/**
 * Mapping a delivered notification onto the bell's record.
 *
 * The two shapes disagree in ways that are easy to paper over and then get
 * subtly wrong: the server records what was true when the notification fired,
 * while the bell renders what is true about the task now. Which side wins for
 * each field is a decision, so each decision is asserted.
 */
import { describe, it, expect } from 'vitest';
import { toRecord, toRecords, classify, taskIdOf } from '@/lib/notificationMapping';
import type { ApiNotification } from '@/lib/api';
import type { Todo } from '@/types/todo';

const NOW = 1_700_000_000_000;

function entry(over: Partial<ApiNotification> = {}): ApiNotification {
  return {
    id: 'n1',
    title: 'Prepare the deck',
    body: 'Due in 30 minutes.',
    kind: 'TASK_REMINDER',
    sourceType: 'TASK',
    sourceId: 't1',
    readAt: 0,
    createdAt: NOW - 60_000,
    payload: { taskId: 't1', dueAt: NOW + 1_800_000, minutesBefore: 30 },
    ...over,
  };
}

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    text: 'Prepare the deck',
    completed: false,
    quadrant: 'do',
    createdAt: NOW - 86_400_000,
    ...over,
  } as Todo;
}

describe('taskIdOf', () => {
  it('prefers the payload, which the server writes deliberately', () => {
    expect(taskIdOf(entry({ payload: { taskId: 'from-payload' }, sourceId: 'other' })))
      .toBe('from-payload');
  });

  it('falls back to SourceId for a task notification', () => {
    expect(taskIdOf(entry({ payload: {}, sourceId: 't9' }))).toBe('t9');
  });

  it('does not treat a rule id as a task id', () => {
    // SourceId is a rule id for an automation; using it would deep-link to a
    // task that does not exist.
    expect(taskIdOf(entry({ payload: {}, sourceType: 'RULE', sourceId: 'rule-4' }))).toBe('');
  });
});

describe('classify', () => {
  it('is upcoming while the due instant is ahead', () => {
    expect(classify(entry({ payload: { dueAt: NOW + 1000 } }), NOW)).toBe('upcoming');
  });

  it('is missed once the due instant has passed', () => {
    expect(classify(entry({ payload: { dueAt: NOW - 1000 } }), NOW)).toBe('missed');
  });

  it('is upcoming when there is no due instant to judge by', () => {
    expect(classify(entry({ payload: {} }), NOW)).toBe('upcoming');
    expect(classify(entry({ payload: undefined }), NOW)).toBe('upcoming');
  });

  it('ignores a due instant that is not a number', () => {
    expect(classify(entry({ payload: { dueAt: 'soon' } }), NOW)).toBe('upcoming');
  });
});

describe('toRecord', () => {
  const none = new Set<string>();

  it('carries the notification across', () => {
    const r = toRecord(entry(), [todo()], none, NOW);

    expect(r.id).toBe('n1');
    expect(r.taskId).toBe('t1');
    expect(r.triggeredAt).toBe(NOW - 60_000);
    expect(r.minutesBefore).toBe(30);
  });

  it('prefers the task\'s current text over the title it fired with', () => {
    // The user renamed the task after the reminder was queued; showing the old
    // name would look like a bug.
    const r = toRecord(entry(), [todo({ text: 'Prepare the deck (final)' })], none, NOW);

    expect(r.taskText).toBe('Prepare the deck (final)');
  });

  it('falls back to the delivered title when the task is gone', () => {
    const r = toRecord(entry(), [], none, NOW);

    expect(r.taskText).toBe('Prepare the deck');
    expect(r.quadrant).toBe('schedule');
  });

  it('takes the quadrant from the task, not the delivery', () => {
    const r = toRecord(entry(), [todo({ quadrant: 'eliminate' })], none, NOW);

    expect(r.quadrant).toBe('eliminate');
  });

  it('treats read on the server as dismissed in the bell', () => {
    expect(toRecord(entry({ readAt: 0 }), [todo()], none, NOW).dismissed).toBe(false);
    expect(toRecord(entry({ readAt: NOW }), [todo()], none, NOW).dismissed).toBe(true);
  });

  it('does not re-toast something already toasted this session', () => {
    const toasted = new Set(['n1']);

    expect(toRecord(entry(), [todo()], toasted, NOW).seenInToast).toBe(true);
    expect(toRecord(entry({ id: 'n2' }), [todo()], toasted, NOW).seenInToast).toBe(false);
  });

  it('does not toast something already read', () => {
    expect(toRecord(entry({ readAt: NOW }), [todo()], none, NOW).seenInToast).toBe(true);
  });

  it('omits minutesBefore rather than inventing one', () => {
    const r = toRecord(entry({ payload: { taskId: 't1' } }), [todo()], none, NOW);

    expect(r.minutesBefore).toBeUndefined();
  });
});

describe('toRecords', () => {
  it('maps a page, preserving order', () => {
    const records = toRecords(
      [entry({ id: 'a' }), entry({ id: 'b' })],
      [todo()],
      new Set(),
      NOW,
    );

    expect(records.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('handles an empty inbox', () => {
    expect(toRecords([], [], new Set(), NOW)).toEqual([]);
  });
});
