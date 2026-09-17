import { describe, expect, it } from 'vitest';
import { parseCatalystJson } from '../../scripts/catalyst-json.mjs';

describe('parseCatalystJson', () => {
  it('keeps Catalyst ROWIDs as their exact decimal strings', () => {
    const parsed = parseCatalystJson(
      '{"data":[{"KaizenTasks":{"ROWID":69251000000086009,"TaskOrder":2}}]}',
    ) as { data: Array<{ KaizenTasks: { ROWID: string; TaskOrder: number } }> };

    expect(parsed.data[0].KaizenTasks).toEqual({ ROWID: '69251000000086009', TaskOrder: 2 });
  });

  it('preserves quoted IDs and ordinary numeric values', () => {
    expect(parseCatalystJson('{"ROWID":"69251000000086009","count":1.5}'))
      .toEqual({ ROWID: '69251000000086009', count: 1.5 });
  });
});
