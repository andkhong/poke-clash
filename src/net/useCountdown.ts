import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 250;

function computeRemaining(endsAtMs: number | null): number {
  if (endsAtMs === null) return 0;
  return Math.max(0, endsAtMs - Date.now());
}

/** Milliseconds remaining until `endsAtMs`, computed locally against the
 * server-provided absolute timestamp — never advanced by incoming network
 * messages, so a slow/dropped stateUpdate can't stall the visible countdown. */
export function useCountdown(endsAtMs: number | null): number {
  const [remainingMs, setRemainingMs] = useState(() => computeRemaining(endsAtMs));

  useEffect(() => {
    setRemainingMs(computeRemaining(endsAtMs));
    if (endsAtMs === null) return;
    const interval = setInterval(() => setRemainingMs(computeRemaining(endsAtMs)), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [endsAtMs]);

  return remainingMs;
}
