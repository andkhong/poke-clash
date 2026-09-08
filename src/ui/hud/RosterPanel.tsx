import type { SimState } from '../../sim/types';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { RosterRow } from './RosterRow';

interface RosterPanelProps {
  state: SimState;
}

/** Grid of every Pokémon in the match, in original spawn order — a row empties
 * out (rather than disappearing) once that Pokémon faints, matching the
 * persistent roster panel seen in the example videos. */
export function RosterPanel({ state }: RosterPanelProps) {
  if (state.teams) return <TeamRosterPanel state={state} />;

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

/** Team Mode's roster layout: each side gets its own labeled column instead
 * of one undifferentiated grid, so a spectator can tell at a glance which
 * Pokémon are on the same side without reading every row. */
function TeamRosterPanel({ state }: RosterPanelProps) {
  const teamAIds = state.allInstanceIds.filter((id) => state.pokemon[id].team === 'teamA');
  const teamBIds = state.allInstanceIds.filter((id) => state.pokemon[id].team === 'teamB');

  return (
    <div style={{ display: 'flex', gap: 6, padding: 6, pointerEvents: 'none' }}>
      <TeamColumn label="TEAM A" color={TEAM_A_COLOR_CSS} ids={teamAIds} state={state} />
      <TeamColumn label="TEAM B" color={TEAM_B_COLOR_CSS} ids={teamBIds} state={state} />
    </div>
  );
}

function TeamColumn({ label, color, ids, state }: { label: string; color: string; ids: string[]; state: SimState }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: 1,
          color,
        }}
      >
        {label}
      </span>
      {ids.map((id) => {
        const pokemon = state.pokemon[id];
        const fainted = !state.livingOrder.includes(id);
        return <RosterRow key={id} pokemon={pokemon} fainted={fainted} accentColor={color} />;
      })}
    </div>
  );
}
