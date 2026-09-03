import { useRef } from 'react';
import type { SimState } from '../../sim/types';

const FINAL_TWO_BANNER_MS = 2600;

interface BannerOverlayProps {
  state: SimState;
}

/** More than one winner happens when the 90s hard time limit is hit with
 * several Pokémon still standing — they're declared co-winners together. */
function formatWinnerText(names: string[]): string {
  const upper = names.map((n) => n.toUpperCase());
  if (upper.length <= 1) return `${upper[0] ?? '???'} WINS!`;
  if (upper.length <= 3) {
    const last = upper[upper.length - 1];
    const rest = upper.slice(0, -1);
    return `${rest.join(', ')} & ${last} WIN!`;
  }
  return `${upper.slice(0, 2).join(', ')} & ${upper.length - 2} MORE WIN!`;
}

/** Derives all three match-flow banners ("WHO WILL WIN?" / "FINAL TWO" /
 * "<WINNER> WINS!") straight from state.phase + state.elapsedMs rather than
 * consuming the sim event log — simpler, and idempotent under React
 * StrictMode's double-render since it never mutates shared state. */
export function BannerOverlay({ state }: BannerOverlayProps) {
  const finalTwoStartRef = useRef<number | null>(null);
  if (state.phase === 'finalTwo' && finalTwoStartRef.current === null) {
    finalTwoStartRef.current = state.elapsedMs;
  }

  let text: string | null = null;
  if (state.phase === 'intro') {
    text = 'WHO WILL WIN?';
  } else if (state.phase === 'complete' && state.winnerInstanceIds.length > 0) {
    text = formatWinnerText(state.winnerInstanceIds.map((id) => state.pokemon[id].name));
  } else if (
    state.phase === 'finalTwo' &&
    finalTwoStartRef.current !== null &&
    state.elapsedMs - finalTwoStartRef.current < FINAL_TWO_BANNER_MS
  ) {
    text = 'FINAL TWO';
  }

  if (!text) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '44%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: 'rgba(245,240,230,0.96)',
          border: '3px solid #8a7a5c',
          borderRadius: 6,
          padding: '10px 24px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          fontSize: 18,
          color: '#3a3630',
          letterSpacing: 1,
          textAlign: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    </div>
  );
}
