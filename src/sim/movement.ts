import type { ArenaBounds, FacingDirection, PokemonInstance, Vec2 } from './types';
import { ARENA_PADDING, ARENA_TOP_PADDING, CHASE_SPEED, getFenceInsets, getRedZoneInsets } from './constants';

/** The playable rectangle a Pokémon is confined
 * to. Its outer line is the arena's own edge on a portrait/mobile arena,
 * and the fence drawn around the pitch on a landscape/desktop one (see
 * getFenceInsets) — an invisible wall along the visible one, so nobody ever
 * walks through it. Inside that line sits ARENA_PADDING's small fixed
 * buffer on the left/right/bottom (absent a red zone, that's the whole
 * story on those three sides), plus the red zone's own per-side reservation
 * (see getRedZoneInsets) added on top of it on a portrait arena, so
 * recorded footage never hides a Pokémon behind Instagram's own
 * Story-viewer UI. The top edge instead takes whichever of ARENA_TOP_PADDING
 * (our own HUD's reservation), the red zone's top inset, or the fence's top
 * line plus the buffer is lowest on screen, not all of them added together
 * — each is just "how far down from y=0 is off limits," so a Pokémon clear
 * of the largest one is already clear of the others too; adding them would
 * reserve the same strip twice over. The single definition of the boundary. */
export function getPlayableBounds(arena: ArenaBounds): { minX: number; maxX: number; minY: number; maxY: number } {
  const redZone = getRedZoneInsets(arena);
  const fence = getFenceInsets(arena);
  return {
    minX: fence.left + ARENA_PADDING + redZone.left,
    maxX: arena.width - fence.right - ARENA_PADDING - redZone.right,
    minY: Math.max(ARENA_TOP_PADDING, redZone.top, fence.top + ARENA_PADDING),
    maxY: arena.height - fence.bottom - ARENA_PADDING - redZone.bottom,
  };
}

/** Clamps a point to the arena's playable bounds — see getPlayableBounds. */
export function clampToArenaBounds(pos: Vec2, arena: ArenaBounds): Vec2 {
  const b = getPlayableBounds(arena);
  return {
    x: Math.max(b.minX, Math.min(b.maxX, pos.x)),
    y: Math.max(b.minY, Math.min(b.maxY, pos.y)),
  };
}

/** Hard collision pass: after everyone's moved this tick, directly separate
 * any pair still overlapping (by their combined collisionRadius), so
 * Pokémon can't walk through each other. O(n²) over living Pokémon, trivial
 * at this roster size. */
export function resolveCollisions(
  livingIds: readonly string[],
  pokemonById: Record<string, PokemonInstance>,
  arena: ArenaBounds
): void {
  for (let i = 0; i < livingIds.length; i++) {
    const a = pokemonById[livingIds[i]];
    for (let j = i + 1; j < livingIds.length; j++) {
      const b = pokemonById[livingIds[j]];
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const d = Math.hypot(dx, dy);
      const minDist = a.collisionRadius + b.collisionRadius;
      if (d >= minDist) continue;

      // Exactly-coincident is a degenerate (near-impossible) case with no
      // well-defined push direction — pick an arbitrary fixed axis rather
      // than dividing by zero.
      const nx = d < 1e-6 ? 1 : dx / d;
      const ny = d < 1e-6 ? 0 : dy / d;
      const push = (minDist - d) / 2;
      a.position.x -= nx * push;
      a.position.y -= ny * push;
      b.position.x += nx * push;
      b.position.y += ny * push;
    }
  }

  for (const id of livingIds) {
    const p = pokemonById[id];
    const clamped = clampToArenaBounds(p.position, arena);
    p.position.x = clamped.x;
    p.position.y = clamped.y;
  }
}

// atan2(y, x) in screen space (y-down) increases clockwise starting at East —
// this order matches that sweep exactly, so bucketing by angle alone (no
// dominant-axis special case) gives the nearest of the 8 compass directions.
const EIGHT_WAY_ORDER: readonly FacingDirection[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const SECTOR_SIZE_RAD = (Math.PI * 2) / 8;
/** Extra angular buffer (beyond the sector's own half-width) the velocity must
 * cross before facing switches away from its current sector. Without this, a
 * seek direction sitting right at a sector boundary (e.g. approaching a
 * wander waypoint dead ahead) could flip `facing` every tick on nothing more
 * than rounding noise — and since the renderer restarts its walk animation on
 * every facing change, that reads as a stuttering "hop" instead of a smooth
 * walk cycle. */
const HYSTERESIS_RAD = (10 * Math.PI) / 180;

/** Buckets velocity into the nearest of 8 compass directions; keeps the
 * previous facing when nearly stationary, or when the new angle hasn't moved
 * meaningfully past the current sector's boundary, to avoid jitter. */
export function velocityToFacing(v: Vec2, previous: FacingDirection): FacingDirection {
  if (Math.abs(v.x) < 1e-3 && Math.abs(v.y) < 1e-3) return previous;
  const angle = Math.atan2(v.y, v.x);
  const normalized = (angle + Math.PI * 2) % (Math.PI * 2); // 0..2π, 0 = East

  const previousIndex = EIGHT_WAY_ORDER.indexOf(previous);
  const previousCenter = previousIndex * SECTOR_SIZE_RAD;
  const rawDiff = Math.abs(normalized - previousCenter);
  const angularDistanceFromPrevious = Math.min(rawDiff, Math.PI * 2 - rawDiff);
  if (angularDistanceFromPrevious <= SECTOR_SIZE_RAD / 2 + HYSTERESIS_RAD) return previous;

  const sector = Math.round(normalized / SECTOR_SIZE_RAD) % 8;
  return EIGHT_WAY_ORDER[sector];
}

export const CHASE_MOVE_SPEED = CHASE_SPEED;
