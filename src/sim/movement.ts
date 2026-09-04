import type { ArenaBounds, FacingDirection, PokemonInstance, Vec2 } from './types';
import type { Rng } from './rng';
import { rngInt } from './rng';
import {
  ARENA_PADDING,
  ARRIVAL_SLOWDOWN_RADIUS,
  CHASE_SPEED,
  SEPARATION_INFLUENCE_MULTIPLIER,
  SEPARATION_STRENGTH,
  WANDER_SPEED,
} from './constants';

/** Lightweight neighbor view used for separation — deliberately not a full
 * PokemonInstance so callers can pass a tick-start position snapshot instead of
 * live (mid-tick-mutated) positions, keeping per-tick movement order-independent. */
export interface NeighborPosition {
  instanceId: string;
  position: Vec2;
  collisionRadius: number;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len < 1e-6 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

export function buildNeighborListFromPositions(
  ids: readonly string[],
  positions: ReadonlyMap<string, Vec2>,
  pokemonById: Record<string, PokemonInstance>
): NeighborPosition[] {
  return ids.map((id) => ({
    instanceId: id,
    position: positions.get(id)!,
    collisionRadius: pokemonById[id].collisionRadius,
  }));
}

export function pickWanderWaypoint(rng: Rng, arena: ArenaBounds): Vec2 {
  return {
    x: rngInt(rng, ARENA_PADDING, arena.width - ARENA_PADDING),
    y: rngInt(rng, ARENA_PADDING, arena.height - ARENA_PADDING),
  };
}

/**
 * Seek-with-arrival toward a point, plus separation from nearby living Pokémon
 * (boids-lite — the arena is an open bowl with no obstacles, so no pathfinding
 * is needed). Mutates `self.velocity`; caller applies position + bounds via
 * applyMovement(). `neighbors` should be a tick-start position snapshot, not
 * live instances, so movement this tick doesn't depend on iteration order.
 */
export function steerToward(
  self: PokemonInstance,
  target: Vec2,
  speed: number,
  neighbors: readonly NeighborPosition[]
): void {
  const toTarget: Vec2 = { x: target.x - self.position.x, y: target.y - self.position.y };
  const dist = Math.hypot(toTarget.x, toTarget.y);
  const desiredSpeed = dist < ARRIVAL_SLOWDOWN_RADIUS ? speed * (dist / ARRIVAL_SLOWDOWN_RADIUS) : speed;
  const seek = normalize(toTarget);

  let sepX = 0;
  let sepY = 0;
  for (const other of neighbors) {
    if (other.instanceId === self.instanceId) continue;
    const d = distance(self.position, other.position);
    // Sized to each pair's actual on-screen footprint (not a fixed radius) —
    // a Wailord and a Voltorb shouldn't start avoiding each other at the same
    // distance. The hard correction in resolveCollisions() is what actually
    // guarantees no overlap; this just eases the approach so it looks smooth
    // rather than bumping into an invisible wall right at the boundary.
    const influenceRadius = (self.collisionRadius + other.collisionRadius) * SEPARATION_INFLUENCE_MULTIPLIER;
    if (d > 0 && d < influenceRadius) {
      const push = (influenceRadius - d) / influenceRadius;
      sepX += ((self.position.x - other.position.x) / d) * push;
      sepY += ((self.position.y - other.position.y) / d) * push;
    }
  }

  self.velocity = {
    x: seek.x * desiredSpeed + sepX * SEPARATION_STRENGTH,
    y: seek.y * desiredSpeed + sepY * SEPARATION_STRENGTH,
  };
}

export function applyMovement(self: PokemonInstance, dtMs: number, arena: ArenaBounds): void {
  const dtSec = dtMs / 1000;
  self.position.x += self.velocity.x * dtSec;
  self.position.y += self.velocity.y * dtSec;

  self.position.x = Math.max(ARENA_PADDING, Math.min(arena.width - ARENA_PADDING, self.position.x));
  self.position.y = Math.max(ARENA_PADDING, Math.min(arena.height - ARENA_PADDING, self.position.y));

  if (Math.abs(self.velocity.x) > 1 || Math.abs(self.velocity.y) > 1) {
    self.facing = velocityToFacing(self.velocity, self.facing);
  }
}

/**
 * Hard collision pass: after everyone's moved this tick, directly separate
 * any pair still overlapping (by their combined collisionRadius) instead of
 * only discouraging it via steering. The soft separation in steerToward()
 * handles the common case smoothly, but under strong opposing forces (e.g. a
 * fast chaser closing on a fleeing target) it's only a suggestion, not a
 * constraint — this guarantees Pokémon actually can't walk through each
 * other regardless. O(n²) over living Pokémon, trivial at this roster size.
 */
export function resolveCollisions(livingIds: readonly string[], pokemonById: Record<string, PokemonInstance>, arena: ArenaBounds): void {
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
    p.position.x = Math.max(ARENA_PADDING, Math.min(arena.width - ARENA_PADDING, p.position.x));
    p.position.y = Math.max(ARENA_PADDING, Math.min(arena.height - ARENA_PADDING, p.position.y));
  }
}

// atan2(y, x) in screen space (y-down) increases clockwise starting at East —
// this order matches that sweep exactly, so bucketing by angle alone (no
// dominant-axis special case) gives the nearest of the 8 compass directions.
const EIGHT_WAY_ORDER: readonly FacingDirection[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const SECTOR_SIZE_RAD = (Math.PI * 2) / 8;
/** Extra angular buffer (beyond the sector's own half-width) the velocity must
 * cross before facing switches away from its current sector. Without this,
 * steering/separation forces nudging the angle back and forth across a sector
 * boundary (common mid-crowd) flip `facing` every tick — and since the
 * renderer restarts its walk animation on every facing change, that reads as
 * a stuttering "hop" instead of a smooth walk cycle. */
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

export const WANDER_MOVE_SPEED = WANDER_SPEED;
export const CHASE_MOVE_SPEED = CHASE_SPEED;
