import { useEffect, useState } from "react";

/**
 * Progress for a step that reports nothing while it runs: the fill grows with elapsed time against
 * an expected duration (e.g. the average of earlier runs) and stops at 95% until the step finishes.
 * Returns { percent, remainingSec, overdue }.
 */
export function useTimedProgress(active, expectedMs) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(timer);
  }, [active]);
  const expected = Math.max(Number(expectedMs) || 0, 1000);
  return {
    percent: Math.min(95, (elapsed / expected) * 95),
    remainingSec: Math.max(0, Math.round((expected - elapsed) / 1000)),
    overdue: elapsed > expected
  };
}
