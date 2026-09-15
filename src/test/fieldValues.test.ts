import { describe, expect, it } from 'vitest';
import { selectedOptions, valueLabel } from '@/lib/fieldValues';
import type { FieldDef } from '@/types/fields';

const def = (over: Partial<FieldDef> = {}): FieldDef => ({
  id: 'd', name: 'Effort', kind: 'select',
  options: [{ id: 'a', label: 'Low', color: 'sage' }, { id: 'b', label: 'High', color: 'do' }],
  fieldOrder: 0, showOnCard: true, createdAt: 1, updatedAt: 1, ...over,
});

describe('selectedOptions', () => {
  it('returns chosen options in the field\'s order and skips removed ones', () => {
    expect(selectedOptions(def({ kind: 'multi' }), ['b', 'gone', 'a']).map((o) => o.label)).toEqual(['Low', 'High']);
    expect(selectedOptions(def(), 'b').map((o) => o.label)).toEqual(['High']);
    expect(selectedOptions(def(), undefined)).toEqual([]);
  });
});

describe('valueLabel', () => {
  it('labels number, date, checkbox and text values', () => {
    expect(valueLabel(def({ kind: 'number', name: 'Points' }), 3)).toBe('Points: 3');
    expect(valueLabel(def({ kind: 'checkbox', name: 'Blocked' }), true)).toBe('✓ Blocked');
    expect(valueLabel(def({ kind: 'text' }), 'x'.repeat(40))).toHaveLength(28);
    expect(valueLabel(def({ kind: 'date', name: 'Waiting since' }), '2030-06-15')).toBe('Waiting since: Jun 15, 2030');
  });

  it('shows nothing for no value or a select kind', () => {
    expect(valueLabel(def({ kind: 'number' }), undefined)).toBeNull();
    expect(valueLabel(def(), 'a')).toBeNull();
  });
});
