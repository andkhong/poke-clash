import type { PokemonInstance } from '../../sim/types';
import { withBalance } from '../predictions/predictionModel';
import { ACCENT, DESTRUCTIVE } from '../theme';

interface RosterRowProps {
  pokemon: PokemonInstance;
  fainted: boolean;
  /** Team Mode's side color, used for this row's border instead of the
   * default neutral one — lets a row visually read as part of its team's
   * column even on its own. */
  accentColor?: string;
  /** The seated player's wallet behind this fighter, if a human holds its
   * seat (see RoomSlotSummary.balance) — shown as "PIPLUP ($100)". */
  balance?: number | null;
}

export function RosterRow({ pokemon, fainted, accentColor, balance }: RosterRowProps) {
  const ratio = pokemon.maxHp > 0 ? Math.max(0, pokemon.currentHp / pokemon.maxHp) : 0;
  const barColor = fainted ? '#5a3030' : ratio > 0.5 ? '#4caf50' : ratio > 0.2 ? ACCENT : DESTRUCTIVE;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 6px',
        background: 'rgba(40,44,52,0.85)',
        border: `1px solid ${accentColor ? `${accentColor}66` : 'rgba(255,255,255,0.15)'}`,
        borderRadius: 3,
        opacity: fainted ? 0.55 : 1,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: 'monospace',
          color: fainted ? '#a08080' : '#fff',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: '1 1 auto',
          minWidth: 0,
        }}
      >
        {withBalance(pokemon.name, balance)}
      </span>
      <div
        style={{
          width: 40,
          height: 6,
          background: '#1a1a1a',
          borderRadius: 2,
          overflow: 'hidden',
          flex: '0 0 auto',
        }}
      >
        <div style={{ width: `${ratio * 100}%`, height: '100%', background: barColor }} />
      </div>
    </div>
  );
}
