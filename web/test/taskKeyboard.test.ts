import { describe, expect, it } from 'vitest';
import { actionFor, clampIndex, isTypingTarget, shiftQuadrant, toggledStatus } from '@/lib/taskKeyboard';

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('taskKeyboard', () => {
  it('maps the vim keys and the arrows to the same moves', () => {
    expect(actionFor(key('j'))).toBe('down');
    expect(actionFor(key('ArrowDown'))).toBe('down');
    expect(actionFor(key('k'))).toBe('up');
    expect(actionFor(key('h'))).toBe('left');
    expect(actionFor(key('l'))).toBe('right');
    expect(actionFor(key('['))).toBe('quadrant-prev');
    expect(actionFor(key(']'))).toBe('quadrant-next');
    expect(actionFor(key('x'))).toBe('toggle');
  });

  it('leaves modified keys to the browser', () => {
    expect(actionFor(key('k', { metaKey: true }))).toBeNull();
    expect(actionFor(key('l', { ctrlKey: true }))).toBeNull();
    expect(actionFor(key('x', { altKey: true }))).toBeNull();
    expect(actionFor(key('q'))).toBeNull();
  });

  it('knows when a key belongs to a field or a menu', () => {
    const input = document.createElement('input');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.append(item);
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(item)).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('keeps a cursor inside the list', () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(4, 0)).toBe(0);
  });

  it('moves a task a quadrant, and stops at the ends', () => {
    expect(shiftQuadrant('do', 1)).toBe('schedule');
    expect(shiftQuadrant('do', -1)).toBeNull();
    expect(shiftQuadrant('eliminate', 1)).toBeNull();
    expect(toggledStatus('done')).toBe('todo');
    expect(toggledStatus('in-progress')).toBe('done');
  });
});
