import type { SimState } from '../../sim/types';

interface BannerOverlayProps {
  state: SimState;
  /** Shown in the same banner box instead of whatever `state` would derive —
   * used for the always-on showcase room's "next round in Ns" countdown
   * during the post-match gap, when `state` is still frozen on the finished
   * match's own phase (so the normal derivation below would otherwise keep
   * showing its stale WINS banner). Omit to use the normal derivation. */
  overrideText?: string;
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

/** Derives both match-flow banners ("PLACE YOUR BETS?" / "<WINNER> WINS!")
 * straight from state.phase rather than consuming the sim event log —
 * simpler, and idempotent under React StrictMode's double-render since it
 * never mutates shared state. There's no "FINAL TWO" banner: it used to fire
 * at the same dead-center spot as the other two, which just added noise over
 * an arena already down to its last two Pokémon. */
export function BannerOverlay({ state, overrideText }: BannerOverlayProps) {
  let text: string | null = overrideText ?? null;
  if (text === null) {
    if (state.phase === 'intro') {
      text = 'PLACE YOUR BETS?';
    } else if (state.phase === 'complete' && state.winnerInstanceIds.length > 0) {
      text = formatWinnerText(state.winnerInstanceIds.map((id) => state.pokemon[id].name));
    }
  }

  if (!text) return null;

  // The winner's own victory pose (see engine.ts's completeMatch) teleports
  // it to dead-center — the same spot every other banner uses — so that one
  // banner alone sits higher, clear of the sprite, instead of covering it.
  const topPosition = state.phase === 'complete' ? '18%' : '44%';

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: topPosition,
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
