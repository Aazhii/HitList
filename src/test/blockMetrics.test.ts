import { describe, expect, it } from 'vitest';
import type { BlockType } from '@/types/notes';
import {
  BLOCK_METRICS,
  MARKER_BOX_CLASS,
  MARKER_COL,
  MARKER_GAP,
  controlsTop,
  getBlockTextClass,
  markerTop,
} from '@/components/notes/blockMetrics';

const TYPES = Object.keys(BLOCK_METRICS) as BlockType[];

describe('blockMetrics', () => {
  it('centres the 22px controls on each block type’s first line', () => {
    expect(controlsTop('paragraph')).toBe(3);
    expect(controlsTop('bullet')).toBe(3);
    expect(controlsTop('numbered')).toBe(3);
    expect(controlsTop('todo')).toBe(3);
    expect(controlsTop('heading1')).toBe(8);
    expect(controlsTop('heading2')).toBe(5);
    expect(controlsTop('heading3')).toBe(2);
    expect(controlsTop('quote')).toBe(3);
    expect(controlsTop('code')).toBe(16);
    expect(controlsTop('callout')).toBe(18);
    expect(controlsTop('table')).toBe(11);
    expect(controlsTop('divider')).toBe(1);
  });

  it('centres markers on the first line', () => {
    // 6px bullet on a 27.72px line: centre 13.86 → 11 (was a hand-set 10).
    expect(markerTop('bullet', 6)).toBe(11);
    // 19px to-do box.
    expect(markerTop('todo', 19)).toBe(4);
    // 22px emoji box inside the callout panel.
    expect(markerTop('callout', 22)).toBe(2);
  });

  it('keeps the text classes in step with the metrics', () => {
    for (const type of TYPES) {
      if (type === 'divider') continue;
      const { fontSize, lineHeight } = BLOCK_METRICS[type];
      const cls = getBlockTextClass(type);
      expect(cls, type).toContain(`text-[${fontSize}px]`);
      expect(cls, type).toContain(`leading-[${lineHeight}]`);
    }
  });

  it('keeps the marker column class in step with its numbers', () => {
    expect(MARKER_BOX_CLASS).toContain(`w-[${MARKER_COL}px]`);
    expect(MARKER_BOX_CLASS).toContain(`mr-[${MARKER_GAP}px]`);
    expect(MARKER_COL + MARKER_GAP).toBe(28);
  });
});
