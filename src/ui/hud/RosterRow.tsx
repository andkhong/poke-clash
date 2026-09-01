import type { PokemonInstance } from '../../sim/types';

interface RosterRowProps {
  pokemon: PokemonInstance;
  fainted: boolean;
}

export function RosterRow({ pokemon, fainted }: RosterRowProps) {
  const ratio = pokemon.maxHp > 0 ? Math.max(0, pokemon.currentHp / pokemon.maxHp) : 0;
  const barColor = fainted ? '#5a3030' : ratio > 0.5 ? '#4caf50' : ratio > 0.2 ? '#e0b030' : '#d9453d';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 6px',
        background: 'rgba(40,44,52,0.85)',
        border: '1px solid rgba(255,255,255,0.15)',
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
        {pokemon.name}
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
