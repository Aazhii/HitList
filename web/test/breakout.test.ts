import { describe, expect, it } from 'vitest';
import { breakoutBox } from '@/lib/breakout';

describe('breakoutBox', () => {
  it('runs as wide as the page content, starting at the page\'s content edge, not the narrow column', () => {
    // A 1400px page with 32px padding; the column is 720px wide and centred (starts at 340).
    const box = breakoutBox({ pageLeft: 0, pageWidth: 1400, padLeft: 32, padRight: 32, columnLeft: 340, columnWidth: 720 });
    expect(box).toEqual({ width: 1336, left: -308 });
  });

  it('keeps room on the left for the block controls', () => {
    const box = breakoutBox({ pageLeft: 0, pageWidth: 1400, padLeft: 32, padRight: 32, columnLeft: 340, columnWidth: 720, inset: 44 });
    expect(box).toEqual({ width: 1292, left: -264 });
  });

  it('keeps the block in its column when the page is narrower than the column', () => {
    const box = breakoutBox({ pageLeft: 0, pageWidth: 600, padLeft: 16, padRight: 16, columnLeft: 16, columnWidth: 568 });
    expect(box).toEqual({ width: 568, left: 0 });
  });

  it('never starts to the right of the column', () => {
    const box = breakoutBox({ pageLeft: 100, pageWidth: 800, padLeft: 0, padRight: 0, columnLeft: 50, columnWidth: 700 });
    expect(box.left).toBe(0);
  });
});
