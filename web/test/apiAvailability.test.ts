import { afterEach, describe, expect, it, vi } from 'vitest';
import { automationApi, trialFeatureApi } from '@/lib/api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('feature switches and the automations client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads notifications and automations from the server', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ notifications: true, automations: true }));
    await expect(trialFeatureApi.get()).resolves.toEqual({ notifications: true, automations: true, unavailableReason: undefined });
  });

  it('explains what a server has switched off', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ notifications: true, automations: false }));
    const got = await trialFeatureApi.get();
    expect(got.automations).toBe(false);
    expect(got.unavailableReason).toMatch(/switched off/);
  });

  it('talks to /api/automations for rules, runs and Run now', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json([]));
    await automationApi.listRules();
    await automationApi.recentRuns(5);
    await automationApi.runsForRule('r1');
    // The client adds ?tz= to every call; the path is what matters here.
    const urls = fetchSpy.mock.calls.map(([url]) => String(url).replace(/^.*?(?=\/api\/)/, '').replace(/[?&]tz=[^&]*/, ''));
    expect(urls).toEqual(['/api/automations', '/api/automations/runs?limit=5', '/api/automations/r1/runs']);

    fetchSpy.mockImplementation(async () => json({ id: 'run1', status: 'SUCCESS' }));
    await automationApi.trigger('r1');
    const [url, init] = fetchSpy.mock.calls.at(-1)!;
    expect(String(url)).toMatch(/\/api\/automations\/r1\/trigger(\?.*)?$/);
    expect((init as RequestInit).method).toBe('POST');
  });
});
