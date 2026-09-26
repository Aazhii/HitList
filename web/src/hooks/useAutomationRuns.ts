/**
 * useAutomationRuns — polls /api/automation-runs/recent every 30 s.
 * Also exposes a manual trigger function that POSTs to /api/automation-runs/trigger/{ruleId}.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { automationRunsApi, ApiAutomationRun } from '../api/automationRunsApi';

const POLL_INTERVAL_MS = 30_000;

export interface UseAutomationRunsReturn {
  runs: ApiAutomationRun[];
  lastChecked: Date | null;
  isLoading: boolean;
  error: string | null;
  triggerRule: (ruleId: string) => Promise<ApiAutomationRun | null>;
  refresh: () => void;
}

export function useAutomationRuns(): UseAutomationRunsReturn {
  const [runs, setRuns] = useState<ApiAutomationRun[]>([]);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      setError(null);
      const data = await automationRunsApi.getRecent();
      setRuns(data);
      setLastChecked(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchRuns();
  }, [fetchRuns]);

  // Initial load + polling
  useEffect(() => {
    setIsLoading(true);
    fetchRuns();

    intervalRef.current = setInterval(fetchRuns, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchRuns]);

  const triggerRule = useCallback(async (ruleId: string): Promise<ApiAutomationRun | null> => {
    try {
      const run = await automationRunsApi.trigger(ruleId);
      // Prepend the new run and keep only 20
      setRuns(prev => [run, ...prev].slice(0, 20));
      setLastChecked(new Date());
      return run;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trigger failed');
      return null;
    }
  }, []);

  return { runs, lastChecked, isLoading, error, triggerRule, refresh };
}
