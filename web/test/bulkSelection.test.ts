import { describe, expect, it } from 'vitest';
import { selectAllState, taskCountLabel, toggleId, visibleSelection } from '@/lib/bulkSelection';

describe('bulkSelection', () => {
  it('toggles an id without touching the original set', () => {
    const a = new Set(['x']);
    const b = toggleId(a, 'y');
    expect([...b]).toEqual(['x', 'y']);
    expect([...toggleId(b, 'x')]).toEqual(['y']);
    expect([...a]).toEqual(['x']);
  });

  it('keeps only what is still on screen, in screen order', () => {
    expect(visibleSelection(new Set(['c', 'a', 'gone']), ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('says whether none, some or all are selected', () => {
    expect(selectAllState(0, 3)).toBe('none');
    expect(selectAllState(2, 3)).toBe('some');
    expect(selectAllState(3, 3)).toBe('all');
    expect(selectAllState(0, 0)).toBe('none');
  });

  it('counts in words', () => {
    expect(taskCountLabel(1)).toBe('1 task');
    expect(taskCountLabel(4)).toBe('4 tasks');
  });
});
