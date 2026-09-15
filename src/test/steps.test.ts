/**
 * A rule's firing steps.
 *
 * The property that matters most here is the last one: a rule written before
 * the OffsetSteps column existed has to keep firing at exactly the instant it
 * always did. Everything else is a new capability; that one is other people's
 * existing reminders.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_STEPS,
  MAX_STEP_MINUTES,
  formatSteps,
  legacyColumnsFor,
  legacyOffsetMinutes,
  normaliseSteps,
  parseSteps,
  stepsForRule,
} from '../../server/automations/steps.ts';

describe('normaliseSteps', () => {
  it('sorts earliest first, drops duplicates and rounds to whole minutes', () => {
    expect(normaliseSteps([30, -5, -60, -5, 0, 1.4])).toEqual([-60, -5, 0, 1, 30]);
  });

  it('drops anything beyond a year either side, and anything not a number', () => {
    expect(normaliseSteps([MAX_STEP_MINUTES + 1, -MAX_STEP_MINUTES - 1, NaN, Infinity, -30]))
      .toEqual([-30]);
  });

  it('caps the list, because every step is a notification', () => {
    const many = Array.from({ length: 20 }, (_, i) => -(i + 1));
    expect(normaliseSteps(many)).toHaveLength(MAX_STEPS);
  });
});

describe('parseSteps / formatSteps', () => {
  it('round-trips the stored column', () => {
    expect(parseSteps(formatSteps([-60, -5, 0, 30]))).toEqual([-60, -5, 0, 30]);
  });

  it('reads an empty or absent column as no steps', () => {
    expect(parseSteps('')).toEqual([]);
    expect(parseSteps(null)).toEqual([]);
    expect(parseSteps(undefined)).toEqual([]);
  });

  it('drops junk rather than failing the whole read', () => {
    expect(parseSteps('-60,,oops,-5')).toEqual([-60, -5]);
  });
});

describe('legacyOffsetMinutes', () => {
  it('converts each unit', () => {
    expect(legacyOffsetMinutes(30, 'minutes')).toBe(30);
    expect(legacyOffsetMinutes(2, 'hours')).toBe(120);
    expect(legacyOffsetMinutes(1, 'days')).toBe(1440);
    // An unknown unit reads as minutes rather than throwing away the number.
    expect(legacyOffsetMinutes(5, 'weeks')).toBe(5);
  });
});

describe('stepsForRule', () => {
  it('uses the stored list when there is one', () => {
    expect(stepsForRule({
      triggerType: 'due-date', offsetValue: 30, offsetUnit: 'minutes', offsetSteps: [-60, -5],
    })).toEqual([-60, -5]);
  });

  // The rules that already exist in production. Each must fire where it did.
  it('derives a due-date rule written before the column as one step before due', () => {
    expect(stepsForRule({
      triggerType: 'due-date', offsetValue: 1, offsetUnit: 'days', offsetSteps: [],
    })).toEqual([-1440]);

    expect(stepsForRule({
      triggerType: 'due-date', offsetValue: 30, offsetUnit: 'minutes', offsetSteps: [],
    })).toEqual([-30]);
  });

  it('derives an overdue rule as a firing at the due instant, ignoring its offset', () => {
    expect(stepsForRule({
      triggerType: 'overdue', offsetValue: 30, offsetUnit: 'minutes', offsetSteps: [],
    })).toEqual([0]);
  });

  it('gives a schedule-driven rule no steps', () => {
    expect(stepsForRule({
      triggerType: 'recurring', offsetValue: 0, offsetUnit: 'minutes', offsetSteps: [],
    })).toEqual([]);
  });
});

describe('legacyColumnsFor', () => {
  it('describes the earliest step in the largest exact unit', () => {
    expect(legacyColumnsFor([-1440, -60])).toEqual({ value: 1, unit: 'days' });
    expect(legacyColumnsFor([-60, -5])).toEqual({ value: 1, unit: 'hours' });
    expect(legacyColumnsFor([-90])).toEqual({ value: 90, unit: 'minutes' });
    expect(legacyColumnsFor([0, 30])).toEqual({ value: 0, unit: 'minutes' });
  });

  it('is harmless for an empty list', () => {
    expect(legacyColumnsFor([])).toEqual({ value: 0, unit: 'minutes' });
  });
});
