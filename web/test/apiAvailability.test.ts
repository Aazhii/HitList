import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOMATIONS_UNAVAILABLE_REASON,
  automationApi,
  trialFeatureApi,
} from '@/lib/api';

describe('migration availability contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes notifications from the server and keeps automations off until they have a backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ notifications: true, automations: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(trialFeatureApi.get()).resolves.toEqual({
      notifications: true,
      automations: false,
      unavailableReason: AUTOMATIONS_UNAVAILABLE_REASON,
    });
  });

  it('cannot create or trigger an automation from the client contract', async () => {
    await expect(automationApi.createRule({} as never)).rejects.toThrow(AUTOMATIONS_UNAVAILABLE_REASON);
    await expect(automationApi.trigger('rule-1')).rejects.toThrow(AUTOMATIONS_UNAVAILABLE_REASON);
  });
});
