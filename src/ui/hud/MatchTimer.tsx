import type { SimState } from '../../sim/types';
import { MATCH_TIME_LIMIT_MS } from '../../sim/constants';

interface MatchTimerProps {
  state: SimState;
}

/** M:SS, rounded up so the display never flashes 0:00 a tick early. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Counts down the match's hard time limit (MATCH_TIME_LIMIT_MS — see
 * engine.ts's stepOnce, which force-ends the match and declares whoever's
 * still standing the winner once elapsedMs reaches it), so a spectator can
 * tell a stalling match apart from one that's about to get cut short.
 * Hidden once the match is over — elapsedMs has stopped advancing by then,
 * and a frozen clock next to the winner banner would just be clutter. */
export function MatchTimer({ state }: MatchTimerProps) {
  if (state.phase === 'complete') return null;
  const remainingMs = Math.max(0, MATCH_TIME_LIMIT_MS - state.elapsedMs);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '4px 0',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          color: '#fff',
          background: 'rgba(40,44,52,0.85)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 3,
          padding: '3px 8px',
          letterSpacing: 0.5,
        }}
      >
        {formatCountdown(remainingMs)}
      </span>
    </div>
  );
}
