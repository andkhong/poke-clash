import type { CSSProperties } from 'react';
import { moveLookup } from '../../data/loader';
import { moveCooldownMs, moveEnergyCost, moveKind, type MoveKind } from '../../sim/action/rules';
import type { MoveDefinition } from '../../sim/types';
import { typeColorCss } from '../typeColorCss';

const KIND_LABEL: Record<MoveKind, string> = { physical: 'Melee', ranged: 'Ranged', aoe: 'Burst', self: 'Self' };

/** A Play Mode moveset as type-colored cards: kind, energy cost, cooldown. */
export function MoveCards({ moveIds }: { moveIds: number[] }) {
  const moves = moveIds.map((id) => moveLookup(id)).filter((m): m is MoveDefinition => m !== undefined);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {moves.map((move, i) => (
        <div key={move.id} style={moveCard(typeColorCss(move.type))}>
          <b>
            {i + 1}. {move.name}
          </b>
          <span style={{ opacity: 0.9 }}>
            {KIND_LABEL[moveKind(move)]} · ⚡{moveEnergyCost(move.pp)} · {(moveCooldownMs(move.pp) / 1000).toFixed(1)}s
          </span>
        </div>
      ))}
    </div>
  );
}

function moveCard(color: string): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 11,
    padding: '6px 8px',
    borderRadius: 6,
    background: color,
    color: '#fff',
    textShadow: '0 1px 0 rgba(0,0,0,0.4)',
  };
}
