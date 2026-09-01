import type { SimState } from '../../sim/types';
import { RosterRow } from './RosterRow';

interface RosterPanelProps {
  state: SimState;
}

/** Grid of every Pokémon in the match, in original spawn order — a row empties
 * out (rather than disappearing) once that Pokémon faints, matching the
 * persistent roster panel seen in the example videos. */
export function RosterPanel({ state }: RosterPanelProps) {
  const columns = state.allInstanceIds.length > 10 ? 3 : state.allInstanceIds.length > 4 ? 2 : 1;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 4,
        padding: 6,
        pointerEvents: 'none',
      }}
    >
      {state.allInstanceIds.map((id) => {
        const pokemon = state.pokemon[id];
        const fainted = !state.livingOrder.includes(id);
        return <RosterRow key={id} pokemon={pokemon} fainted={fainted} />;
      })}
    </div>
  );
}
