import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDensity, readDensity } from '@/hooks/useDensity';

describe('useDensity', () => {
  beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.density; });

  it('starts on Standard and marks the page', () => {
    const { result } = renderHook(() => useDensity());
    expect(result.current[0]).toBe('standard');
    expect(document.documentElement.dataset.density).toBe('standard');
  });

  it('remembers a choice across visits', () => {
    const { result, unmount } = renderHook(() => useDensity());
    act(() => result.current[1]('compact'));
    expect(document.documentElement.dataset.density).toBe('compact');
    unmount();
    expect(readDensity()).toBe('compact');
    expect(renderHook(() => useDensity()).result.current[0]).toBe('compact');
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('hitlist-density', 'huge');
    expect(readDensity()).toBe('standard');
  });
});
