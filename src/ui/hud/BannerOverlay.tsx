import { useRef } from 'react';
import type { SimState } from '../../sim/types';

const FINAL_TWO_BANNER_MS = 2600;

interface BannerOverlayProps {
  state: SimState;
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
  } else if (state.phase === 'complete' && state.winnerInstanceId) {
    text = `${state.pokemon[state.winnerInstanceId].name.toUpperCase()} WINS!`;
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
