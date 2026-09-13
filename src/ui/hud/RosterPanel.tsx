import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { SimState } from '../../sim/types';
import { isMobileArena } from '../../sim/constants';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { RosterRow } from './RosterRow';
import { blockingRowIds, fighterScreenBox, nextHiddenRows, sideRosterFits } from './rosterOcclusion';

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
const SIDE_COLUMN_PADDING_PX = 8;
const SIDE_ROW_GAP_PX = 4;
const SIDE_ROW_FADE_MS = 150;

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
 * a column down each edge instead — but only while they fit outside the
 * fence at the current `stageWidth` (the visible stage's CSS width, see
 * sideRosterFits). On a smaller stage, e.g. a phone opening the landing
 * page's featured room, they'd cover the battle itself, so they're dropped. */
export function RosterPanel({ state, balances, stageWidth }: RosterPanelProps & { stageWidth: number }) {
  if (!isMobileArena(state.arena)) {
    const fits = sideRosterFits(state.arena, stageWidth, SIDE_COLUMN_PADDING_PX + SIDE_COLUMN_WIDTH_PX);
    return fits ? <SideRosterPanel state={state} balances={balances} /> : null;
  }
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
 * much horizontal space is between them.
 *
 * RosterPanel only renders these while they fit outside the fence (see
 * sideRosterFits), but a fighter standing at the fence still reaches a
 * little past it — any row that would cover one fades out until it's
 * clear (see useOccludedRows). */
function SideRosterPanel({ state, balances }: RosterPanelProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const { hiddenIds, registerRow } = useOccludedRows(state, columnRef);

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

  const columnProps = { state, balances, hiddenIds, registerRow };
  return (
    <>
      <SideColumn side="left" ids={leftIds} label={leftLabel} color={leftColor} columnRef={columnRef} {...columnProps} />
      <SideColumn side="right" ids={rightIds} label={rightLabel} color={rightColor} {...columnProps} />
    </>
  );
}

/** Which side-column rows currently cover a living fighter (see
 * rosterOcclusion.ts). Re-checked after every render — useSimSnapshot
 * re-renders the HUD on each 100 ms refresh, and fighters move between every
 * one — by measuring each registered row against the stage overlay (the
 * columns' containing block, so `columnRef`'s offsetParent). */
function useOccludedRows(
  state: SimState,
  columnRef: RefObject<HTMLDivElement>
): { hiddenIds: ReadonlySet<string>; registerRow: (id: string, el: HTMLElement | null) => void } {
  const rowElements = useRef(new Map<string, HTMLElement>());
  const hideUntil = useRef(new Map<string, number>());
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowElements.current.set(id, el);
    else rowElements.current.delete(id);
  }, []);

  // Deliberately no dependency list: SimState is mutated in place, so its
  // fields keep the same identity while fighters move and a list would stop
  // the re-check. The update below keeps `prev` when nothing changed, which
  // bails out of the re-render instead of looping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const stage = columnRef.current?.offsetParent;
    if (!stage) return;
    const stageBox = stage.getBoundingClientRect();
    if (stageBox.width === 0) return;
    const scale = stageBox.width / state.arena.width;

    const rows = [...rowElements.current].map(([id, el]) => {
      const r = el.getBoundingClientRect();
      return {
        id,
        rect: { left: r.left - stageBox.left, top: r.top - stageBox.top, right: r.right - stageBox.left, bottom: r.bottom - stageBox.top },
      };
    });
    const fighters = state.livingOrder.flatMap((id) => {
      const pokemon = state.pokemon[id];
      return pokemon ? [fighterScreenBox(pokemon, scale)] : [];
    });

    const next = nextHiddenRows(hideUntil.current, blockingRowIds(rows, fighters), performance.now());
    hideUntil.current = next;
    setHiddenIds((prev) => (prev.size === next.size && [...next.keys()].every((id) => prev.has(id)) ? prev : new Set(next.keys())));
  });

  return { hiddenIds, registerRow };
}

function SideColumn({
  side,
  ids,
  state,
  label,
  color,
  balances,
  hiddenIds,
  registerRow,
  columnRef,
}: {
  side: 'left' | 'right';
  ids: string[];
  state: SimState;
  label?: string;
  color?: string;
  balances?: Record<string, number | null>;
  hiddenIds: ReadonlySet<string>;
  registerRow: (id: string, el: HTMLElement | null) => void;
  columnRef?: RefObject<HTMLDivElement>;
}) {
  return (
    <div
      ref={columnRef}
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
        padding: `0 ${SIDE_COLUMN_PADDING_PX}px`,
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
        // Faded rather than unmounted, so hiding a row never reflows the
        // column and slides its neighbours onto a fighter.
        return (
          <div
            key={id}
            ref={(el) => registerRow(id, el)}
            style={{ opacity: hiddenIds.has(id) ? 0 : 1, transition: `opacity ${SIDE_ROW_FADE_MS}ms` }}
          >
            <RosterRow pokemon={pokemon} fainted={fainted} accentColor={color} balance={balances?.[id]} />
          </div>
        );
      })}
    </div>
  );
}
