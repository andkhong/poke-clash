import type { CSSProperties } from 'react';
import type { SimState } from '../../sim/types';
import { isMobileArena } from '../../sim/constants';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { RosterRow } from './RosterRow';

interface RosterPanelProps {
  state: SimState;
  /** Wallet balance per instance id for fighters a seated player owns (see
   * MatchScreen.slotBalances); absent or null → the bare species name. */
  balances?: Record<string, number | null>;
}

const COLUMN_GAP_PX = 4;
const TEAM_COLUMN_GAP_PX = 6;
/** Widest a roster row (name + HP bar) gets on the landscape arena. Rows
 * there are sized by column count alone — a full 16-Pokémon roster's three
 * columns fill the stage nicely, but a 4-seat multiplayer room's single
 * column would stretch each row across the whole ~1000px-wide stage, its
 * name at the far left and its HP bar pinned to the far right — so the
 * panel is capped and centred instead. The portrait arena's stage is
 * narrower than this cap at any column count, so it's unaffected. */
const MAX_ROW_WIDTH_PX = 340;
const SIDE_COLUMN_WIDTH_PX = 150;
const SIDE_ROW_GAP_PX = 4;

/** Caps and centres the panel on the landscape arena — see MAX_ROW_WIDTH_PX. */
function panelWidthStyle(state: SimState, columns: number, gapPx: number): CSSProperties {
  if (isMobileArena(state.arena)) return {};
  return { maxWidth: columns * MAX_ROW_WIDTH_PX + (columns - 1) * gapPx, margin: '0 auto' };
}

/** Grid of every Pokémon in the match, in original spawn order — a row empties
 * out (rather than disappearing) once that Pokémon faints, matching the
 * persistent roster panel seen in the example videos. On the wide/desktop
 * arena the roster instead flanks the map as two side columns (see
 * SideRosterPanel) — a top strip reads fine on the tall portrait arena but
 * gets lost above a much wider stage, and the extra width comfortably fits
 * a column down each edge instead. */
export function RosterPanel({ state, balances }: RosterPanelProps) {
  if (!isMobileArena(state.arena)) return <SideRosterPanel state={state} balances={balances} />;
  if (state.teams) return <TeamRosterPanel state={state} balances={balances} />;

  const columns = state.allInstanceIds.length > 10 ? 3 : state.allInstanceIds.length > 4 ? 2 : 1;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: COLUMN_GAP_PX,
        padding: 6,
        pointerEvents: 'none',
        ...panelWidthStyle(state, columns, COLUMN_GAP_PX),
      }}
    >
      {state.allInstanceIds.map((id) => {
        const pokemon = state.pokemon[id];
        const fainted = !state.livingOrder.includes(id);
        return <RosterRow key={id} pokemon={pokemon} fainted={fainted} balance={balances?.[id]} />;
      })}
    </div>
  );
}

/** Team Mode's roster layout: each side gets its own labeled column instead
 * of one undifferentiated grid, so a spectator can tell at a glance which
 * Pokémon are on the same side without reading every row. */
function TeamRosterPanel({ state, balances }: RosterPanelProps) {
  const teamAIds = state.allInstanceIds.filter((id) => state.pokemon[id].team === 'teamA');
  const teamBIds = state.allInstanceIds.filter((id) => state.pokemon[id].team === 'teamB');

  return (
    <div style={{ display: 'flex', gap: TEAM_COLUMN_GAP_PX, padding: 6, pointerEvents: 'none', ...panelWidthStyle(state, 2, TEAM_COLUMN_GAP_PX) }}>
      <TeamColumn label="TEAM A" color={TEAM_A_COLOR_CSS} ids={teamAIds} state={state} balances={balances} />
      <TeamColumn label="TEAM B" color={TEAM_B_COLOR_CSS} ids={teamBIds} state={state} balances={balances} />
    </div>
  );
}

function TeamColumn({ label, color, ids, state, balances }: { label: string; color: string; ids: string[]; state: SimState; balances?: Record<string, number | null> }) {
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
        return <RosterRow key={id} pokemon={pokemon} fainted={fainted} accentColor={color} balance={balances?.[id]} />;
      })}
    </div>
  );
}

/** Wide/desktop arena's roster: flanks the map instead of sitting above it —
 * Team Mode splits by side (teamA left, teamB right, same grouping
 * TeamRosterPanel uses), free-for-all just splits the spawn-order roster
 * list in half. Rendered as two independently-positioned full-height
 * columns (not one flex row) so each hugs its own edge regardless of how
 * much horizontal space is between them. */
function SideRosterPanel({ state, balances }: RosterPanelProps) {
  let leftIds: string[];
  let rightIds: string[];
  let leftLabel: string | undefined;
  let rightLabel: string | undefined;
  let leftColor: string | undefined;
  let rightColor: string | undefined;

  if (state.teams) {
    leftIds = state.allInstanceIds.filter((id) => state.pokemon[id].team === 'teamA');
    rightIds = state.allInstanceIds.filter((id) => state.pokemon[id].team === 'teamB');
    leftLabel = 'TEAM A';
    rightLabel = 'TEAM B';
    leftColor = TEAM_A_COLOR_CSS;
    rightColor = TEAM_B_COLOR_CSS;
  } else {
    const half = Math.ceil(state.allInstanceIds.length / 2);
    leftIds = state.allInstanceIds.slice(0, half);
    rightIds = state.allInstanceIds.slice(half);
  }

  return (
    <>
      <SideColumn side="left" ids={leftIds} state={state} label={leftLabel} color={leftColor} balances={balances} />
      <SideColumn side="right" ids={rightIds} state={state} label={rightLabel} color={rightColor} balances={balances} />
    </>
  );
}

function SideColumn({
  side,
  ids,
  state,
  label,
  color,
  balances,
}: {
  side: 'left' | 'right';
  ids: string[];
  state: SimState;
  label?: string;
  color?: string;
  balances?: Record<string, number | null>;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side]: 0,
        width: SIDE_COLUMN_WIDTH_PX,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: SIDE_ROW_GAP_PX,
        padding: '0 8px',
        pointerEvents: 'none',
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 9,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            letterSpacing: 1,
            color,
            textAlign: side === 'left' ? 'left' : 'right',
          }}
        >
          {label}
        </span>
      )}
      {ids.map((id) => {
        const pokemon = state.pokemon[id];
        const fainted = !state.livingOrder.includes(id);
        return <RosterRow key={id} pokemon={pokemon} fainted={fainted} accentColor={color} balance={balances?.[id]} />;
      })}
    </div>
  );
}
