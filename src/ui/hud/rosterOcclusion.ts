import type { ArenaBounds, PokemonInstance } from '../../sim/types';
import { COLLISION_RADIUS_FACTOR, getFenceInsets } from '../../sim/constants';

/** Whether the wide arena's side roster columns fit in the strip outside the
 * fence on both sides at this stage width. The columns are a fixed CSS width
 * over a canvas scaled to fit its frame, so once the stage shrinks (a phone
 * opening the landing page's featured room, a narrow window) they'd reach
 * across the pitch and cover the battle — RosterPanel drops them instead.
 * `footprintPx` is how far in from the stage's edge a column's rows reach. */
export function sideRosterFits(arena: ArenaBounds, stageWidthPx: number, footprintPx: number): boolean {
  const fence = getFenceInsets(arena);
  return Math.min(fence.left, fence.right) * (stageWidthPx / arena.width) >= footprintPx;
}

/** A box in the stage overlay's own CSS pixels (MatchScreen's stageRect div),
 * origin at the visible map's top-left corner. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Breathing room around a fighter before a roster row counts as covering
 * it, in CSS px — keeps a row from sitting flush against a sprite's edge. */
export const OCCLUSION_MARGIN_PX = 8;
/** How long a row stays hidden after it last covered a fighter. The HUD only
 * re-checks on its 100 ms refresh (HUD_REFRESH_INTERVAL_MS), so without a
 * hold a fighter pacing along the fence would make its row blink. */
export const OCCLUSION_HOLD_MS = 500;
/** How far below its feet a fighter's drawn footprint reaches, in sim px —
 * PokemonSprite hangs the in-world HP bar and status pill under the body. */
const BELOW_FEET_SIM_PX = 30;

/** Where a fighter is drawn, in stage CSS px. `position` is its feet (the
 * body stands above it, see PokemonSprite's 0.75 origin) and the body's
 * longest side is `collisionRadius / COLLISION_RADIUS_FACTOR` — the same
 * size PokemonSprite draws it at. `scale` is stage CSS px per sim px. */
export function fighterScreenBox(
  pokemon: Pick<PokemonInstance, 'position' | 'collisionRadius'>,
  scale: number,
  marginPx: number = OCCLUSION_MARGIN_PX
): ScreenRect {
  const size = pokemon.collisionRadius / COLLISION_RADIUS_FACTOR;
  const { x, y } = pokemon.position;
  return {
    left: (x - size / 2) * scale - marginPx,
    right: (x + size / 2) * scale + marginPx,
    top: (y - size) * scale - marginPx,
    bottom: (y + BELOW_FEET_SIM_PX) * scale + marginPx,
  };
}

function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Ids of the roster rows that overlap any fighter's box. */
export function blockingRowIds(rows: ReadonlyArray<{ id: string; rect: ScreenRect }>, fighters: readonly ScreenRect[]): Set<string> {
  const blocking = new Set<string>();
  for (const row of rows) {
    if (fighters.some((box) => intersects(row.rect, box))) blocking.add(row.id);
  }
  return blocking;
}

/** Each hidden row's "hide until" time: a row blocking a fighter now is held
 * hidden for `holdMs` more, and one that has been clear for that long drops
 * out. The hidden rows are the returned map's keys. */
export function nextHiddenRows(
  prevHideUntil: ReadonlyMap<string, number>,
  blocking: ReadonlySet<string>,
  nowMs: number,
  holdMs: number = OCCLUSION_HOLD_MS
): Map<string, number> {
  const next = new Map<string, number>();
  for (const [id, until] of prevHideUntil) {
    if (until > nowMs) next.set(id, until);
  }
  for (const id of blocking) next.set(id, nowMs + holdMs);
  return next;
}
