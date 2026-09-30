import { fireEvent, renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBoardKeyboard, useTableKeyboard } from '@/hooks/useTaskKeyboard';

const lookup = { statusOf: () => 'todo' as const, quadrantOf: () => 'do' as const };
const press = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); });

describe('useTableKeyboard', () => {
  it('walks rows and cells, and acts on the task under the cursor', () => {
    const handlers = { onEdit: vi.fn(), onOpen: vi.fn(), onStatus: vi.fn(), onQuadrant: vi.fn() };
    const { result } = renderHook(() => useTableKeyboard(['a', 'b'], 3, lookup, handlers));
    expect(result.current.activeId).toBeUndefined();
    press('j');
    expect(result.current.activeId).toBe('a');
    press('j'); press('j');
    expect(result.current.activeId).toBe('b');
    press('l'); press('l'); press('l');
    expect(result.current.activeCol).toBe(2);
    press('Enter');
    expect(handlers.onEdit).toHaveBeenCalledWith('b', 2);
    press('x');
    expect(handlers.onStatus).toHaveBeenCalledWith('b', 'done');
    press(']');
    expect(handlers.onQuadrant).toHaveBeenCalledWith('b', 'schedule');
    press('[');
    expect(handlers.onQuadrant).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(result.current.activeId).toBeUndefined();
  });

  it('ignores keys typed into a field', () => {
    const handlers = { onOpen: vi.fn(), onStatus: vi.fn() };
    const { result } = renderHook(() => useTableKeyboard(['a'], 1, lookup, handlers));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    act(() => { fireEvent.keyDown(input, { key: 'j' }); });
    expect(result.current.activeId).toBeUndefined();
    input.remove();
  });
});

describe('useBoardKeyboard', () => {
  it('skips empty columns sideways and opens the card', () => {
    const handlers = { onOpen: vi.fn(), onStatus: vi.fn() };
    const { result } = renderHook(() => useBoardKeyboard([['a', 'b'], [], ['c']], lookup, handlers));
    press('l');
    expect(result.current.activeId).toBe('a');
    press('l');
    expect(result.current.activeId).toBe('c');
    press('o');
    expect(handlers.onOpen).toHaveBeenCalledWith('c');
    press('h');
    expect(result.current.activeId).toBe('a');
  });
});
