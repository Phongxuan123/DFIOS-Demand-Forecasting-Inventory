import { useEffect, useState } from 'react';

/**
 * Whole seconds elapsed since `active` became true (U-15, R-37): honest progress feedback for long server calls.
 * No fake percentage: the backend gives no progress, so the UI shows the real elapsed time only.
 */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => {
      window.clearInterval(id);
      setElapsed(0);
    };
  }, [active]);
  return active ? elapsed : 0;
}
