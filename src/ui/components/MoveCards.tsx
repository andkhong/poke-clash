import type { CSSProperties } from 'react';
import { moveLookup } from '../../data/loader';
import { moveCooldownMs, moveEnergyCost, moveKind, type MoveKind } from '../../sim/action/rules';
import type { MoveDefinition, PokemonTypeName } from '../../sim/types';
import { FONT_BODY, FONT_UI, INK } from '../theme';
import { typeColorCss, typeTextCss } from '../typeColorCss';

const KIND_LABEL: Record<MoveKind, string> = { physical: 'Melee', ranged: 'Ranged', aoe: 'Burst', self: 'Self' };

/** A Play Mode moveset as type-colored cards: kind, energy cost, cooldown. */
export function MoveCards({ moveIds }: { moveIds: number[] }) {
  const moves = moveIds.map((id) => moveLookup(id)).filter((m): m is MoveDefinition => m !== undefined);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {moves.map((move, i) => (
        <div key={move.id} style={moveCard(move.type)}>
          <b style={{ fontFamily: FONT_UI, fontSize: 18, fontWeight: 700 }}>
            {i + 1}. {move.name}
          </b>
          <span>
            {KIND_LABEL[moveKind(move)]} · ⚡{moveEnergyCost(move.pp)} · {(moveCooldownMs(move.pp) / 1000).toFixed(1)}s
          </span>
        </div>
      ))}
    </div>
  );
}

function moveCard(type: PokemonTypeName): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontFamily: FONT_BODY,
    fontSize: 14,
    fontWeight: 700,
    padding: '6px 10px',
    borderRadius: 6,
    border: `2px solid ${INK}`,
    background: typeColorCss(type),
    color: typeTextCss(type),
  };
}
