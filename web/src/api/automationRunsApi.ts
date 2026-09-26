/**
 * Automation rules and runs, over the API.
 *
 * This file used to talk to a Spring Boot server on localhost:8080 that this
 * project no longer runs, with a wire shape to match — ISO-8601 date strings
 * and JSON blobs stuffed into `reminderOffsetJson` and `recurrenceJson`. None
 * of those endpoints existed, so `useAutomationRuns` polled a 404 every thirty
 * seconds for the life of the session.
 *
 * It now goes through the shared request helper in lib/api.ts, which carries
 * the browser's timezone — which the automation endpoints need, because a
 * rule's recurrence
 * time is a wall clock with no zone of its own.
 */
import { automationApi } from '@/lib/api';
import type { ApiAutomationRule, ApiAutomationRun } from '@/lib/api';

export type { ApiAutomationRule, ApiAutomationRun };

export const automationRunsApi = {
  /** Recent runs for the active workspace owner, newest first. */
  getRecent(limit = 20): Promise<ApiAutomationRun[]> {
    return automationApi.recentRuns(limit);
  },

  /** Runs for one rule. */
  getForRule(ruleId: string): Promise<ApiAutomationRun[]> {
    return automationApi.runsForRule(ruleId);
  },

  /**
   * Queues one firing by hand.
   *
   * Returns the run record. Delivery happens on the next sweep rather than
   * inline, so a manual run takes the same claim-and-deliver path as a
   * scheduled one and cannot become a second way for a notification to be sent.
   */
  trigger(ruleId: string): Promise<ApiAutomationRun> {
    return automationApi.trigger(ruleId);
  },
};
