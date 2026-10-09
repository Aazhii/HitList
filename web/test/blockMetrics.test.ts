import { describe, expect, it } from 'vitest';
import type { BlockType } from '@/types/notes';
import {
  BLOCK_METRICS,
  MARKERS,
  controlsTop,
  getBlockTextClass,
  markerBoxClass,
  markerTop,
} from '@/components/notes/blockMetrics';

const TYPES = Object.keys(BLOCK_METRICS) as BlockType[];

describe('blockMetrics', () => {
  // The numbers follow the prototype's type scale (body 14, headings 24/20/16, quote 15,
  // code 12) and its 28px gutter buttons. They are derived, not chosen —
  // each is round(insetTop + fontSize * lineHeight / 2 - 14).
  it('centres the 28px controls on each block type’s first line', () => {
    expect(controlsTop('paragraph')).toBe(-2);
    expect(controlsTop('bullet')).toBe(-1);
    expect(controlsTop('numbered')).toBe(-1);
    expect(controlsTop('todo')).toBe(1);
    expect(controlsTop('heading1')).toBe(0);
    expect(controlsTop('heading2')).toBe(-2);
    expect(controlsTop('heading3')).toBe(-4);
    expect(controlsTop('quote')).toBe(0);
    expect(controlsTop('code')).toBe(10);
    expect(controlsTop('callout')).toBe(9);
    expect(controlsTop('table')).toBe(4);
    expect(controlsTop('divider')).toBe(-2);
  });

  it('centres markers on the first line', () => {
    // 5px bullet on a 25.2px line: centre 12.6 → 10.
    expect(markerTop('bullet', 5)).toBe(10);
    // 16px checkbox on a 21px line.
    expect(markerTop('todo', 16)).toBe(3);
    // 18px emoji inside the callout panel.
    expect(markerTop('callout', 18)).toBe(2);
  });

  it('keeps the text classes in step with the metrics', () => {
    for (const type of TYPES) {
      if (type === 'divider' || type === 'database' || type === 'codefile') continue;
      const { fontSize, lineHeight } = BLOCK_METRICS[type];
      const cls = getBlockTextClass(type);
      expect(cls, type).toContain(`text-[${fontSize}px]`);
      expect(cls, type).toContain(`leading-[${lineHeight}]`);
    }
  });

  it('keeps the marker column classes in step with their numbers', () => {
    for (const type of ['todo', 'bullet', 'numbered', 'callout'] as const) {
      const { col, gap } = MARKERS[type];
      expect(markerBoxClass(type), type).toContain(`w-[${col}px]`);
      expect(markerBoxClass(type), type).toContain(`mr-[${gap}px]`);
    }
    // Lists put their text at 22px, to-dos at 26.
    expect(MARKERS.bullet.col + MARKERS.bullet.gap).toBe(22);
    expect(MARKERS.todo.col + MARKERS.todo.gap).toBe(26);
  });
});
