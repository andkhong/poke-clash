import type { ArenaBounds, FacingDirection, PokemonInstance, Vec2 } from './types';
import type { Rng } from './rng';
import {
  ARENA_PADDING,
  ARENA_TOP_PADDING,
  ARRIVAL_SLOWDOWN_RADIUS,
  CHASE_SPEED,
  getRedZoneInsets,
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

/** Minimum distance (px) a new wander waypoint must be from the Pokémon's
 * current position. A fully position-independent uniform-random point can
 * land close by chance, and with only a few seconds of guaranteed wander
 * time before combat is allowed to lock in, an unlucky short pick barely
 * moves anyone out of the tightly-packed spawn circle. Picking a random
 * direction plus a random distance in [MIN, MIN+RANGE] instead guarantees
 * every leg is a real trek across the arena while staying fully random. */
const MIN_WANDER_DISTANCE = 400;
const WANDER_DISTANCE_RANGE = 500;

/** Clamps a point to the arena's playable bounds — ARENA_PADDING's small
 * fixed edge buffer on the left/right/bottom (absent a red zone, that's the
 * whole story on those three sides), plus the red zone's own per-side
 * reservation (see getRedZoneInsets) added on top of it on a portrait/mobile
 * arena, so recorded footage never hides a Pokémon behind Instagram's own
 * Story-viewer UI. The top edge instead takes whichever of ARENA_TOP_PADDING
 * (our own HUD's reservation) or the red zone's top inset is bigger, not
 * both added together — both are just "how far down from y=0 is off
 * limits," so a Pokémon clear of the larger one is already clear of the
 * smaller one too; adding them would reserve the same strip twice over.
 * Shared by every call site that needs to keep a position (or a candidate
 * one) inside the arena, so the boundary can only ever be defined in one
 * place. */
export function clampToArenaBounds(pos: Vec2, arena: ArenaBounds): Vec2 {
  const redZone = getRedZoneInsets(arena);
  const topBound = Math.max(ARENA_TOP_PADDING, redZone.top);
  return {
    x: Math.max(ARENA_PADDING + redZone.left, Math.min(arena.width - ARENA_PADDING - redZone.right, pos.x)),
    y: Math.max(topBound, Math.min(arena.height - ARENA_PADDING - redZone.bottom, pos.y)),
  };
}

/** A raw random angle/distance cast from right at (or near) a wall lands
 * out-of-bounds about as often as not — clamping that back onto the
 * boundary (see clampToArenaBounds) tends to produce another point sitting
 * on that very same wall, since only the axis that overshot gets pulled in
 * while the other rides along it unchanged. steerToward() then aims straight
 * at that new point, which is a walk *along* the wall rather than away from
 * it — repeat that a few legs in a row (each new pick has the same ~50/50
 * odds) and it reads as sliding along the wall instead of redirecting into
 * the arena. */
const MAX_WANDER_PICK_ATTEMPTS = 8;

export function pickWanderWaypoint(rng: Rng, arena: ArenaBounds, from: Vec2): Vec2 {
  // Retry with a fresh random angle whenever the cast needed clamping at
  // all, keeping only a pick that lands fully in-bounds unmodified — that
  // makes heading back into the open arena the common case instead of a
  // coin flip. Falls through to the old clamp-whatever-you-get behavior only
  // if every attempt still needed it (a very small arena, or boxed into a
  // corner), so this can never spin or fail to return a value.
  let lastCandidate: Vec2 = from;
  for (let attempt = 0; attempt < MAX_WANDER_PICK_ATTEMPTS; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = MIN_WANDER_DISTANCE + rng() * WANDER_DISTANCE_RANGE;
    const candidate = { x: from.x + Math.cos(angle) * dist, y: from.y + Math.sin(angle) * dist };
    const clamped = clampToArenaBounds(candidate, arena);
    if (clamped.x === candidate.x && clamped.y === candidate.y) return candidate;
    lastCandidate = candidate;
  }
  return clampToArenaBounds(lastCandidate, arena);
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

  // Facing follows this pure "where am I actually trying to go" direction,
  // not the final self.velocity computed below — separation is a corrective
  // nudge, freshly resummed every tick from whoever happens to be
  // overlapping this instant, and its direction can swing hard tick to tick
  // when several (especially large-collision-radius) Pokémon are packed
  // together. Blending that into the vector facing is derived from turns
  // "which way is the crowd jostling me" into the Pokémon's visible
  // orientation, which whips back and forth far faster than any real turn —
  // this is what actually produced Pokémon reading as "spinning wildly" in a
  // packed 16-Pokémon match (worst with large species like legendaries,
  // whose big collision radii mean heavier, near-constant overlap). Skipped
  // when there's nowhere to go at all (steerToward's hold-still callers pass
  // target=self.position, i.e. dist=0) — those states' facing is handled
  // separately (see PokemonSprite.ts's desiredFacing).
  if (dist > 1e-3) {
    self.facing = velocityToFacing(seek, self.facing);
  }

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

/** Moves `self` by its current velocity and clamps it back inside the arena.
 * Returns whether either axis actually got clamped (i.e. it just walked into
 * the boundary) — steerToward() recomputes velocity from scratch every tick
 * purely from the current waypoint/target, with no memory of last tick's
 * motion, so clamping position alone doesn't stop it from re-aiming at the
 * same spot (through the wall) again next tick. A wandering Pokémon has no
 * other reason to want to go there specifically — see stepMovement's 'wander'
 * branch, which uses this to drop the stale waypoint and pick a new direction
 * instead of pressing against the wall indefinitely.
 *
 * Facing is set by steerToward() itself, not here — see that function's own
 * comment for why it has to be derived from the pure seek direction rather
 * than this function's `self.velocity` (which also carries separation). */
export function applyMovement(self: PokemonInstance, dtMs: number, arena: ArenaBounds): boolean {
  const dtSec = dtMs / 1000;
  self.position.x += self.velocity.x * dtSec;
  self.position.y += self.velocity.y * dtSec;

  const clamped = clampToArenaBounds(self.position, arena);
  const hitWall = clamped.x !== self.position.x || clamped.y !== self.position.y;
  self.position.x = clamped.x;
  self.position.y = clamped.y;

  return hitWall;
}

/**
 * Hard collision pass: after everyone's moved this tick, directly separate
 * any pair still overlapping (by their combined collisionRadius) instead of
 * only discouraging it via steering. The soft separation in steerToward()
 * handles the common case smoothly, but under strong opposing forces (e.g. a
 * fast chaser closing on a fleeing target) it's only a suggestion, not a
 * constraint — this guarantees Pokémon actually can't walk through each
 * other regardless. O(n²) over living Pokémon, trivial at this roster size.
 *
 * Returns every instance id that got pushed apart this tick, same reasoning
 * as applyMovement's own return — a wandering Pokémon pinned against another
 * one has no memory of that either, so steerToward() would just aim it
 * straight back at the same spot next tick. See stepMovement's 'wander'
 * branch.
 */
export function resolveCollisions(
  livingIds: readonly string[],
  pokemonById: Record<string, PokemonInstance>,
  arena: ArenaBounds
): Set<string> {
  const collided = new Set<string>();
  for (let i = 0; i < livingIds.length; i++) {
    const a = pokemonById[livingIds[i]];
    for (let j = i + 1; j < livingIds.length; j++) {
      const b = pokemonById[livingIds[j]];
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const d = Math.hypot(dx, dy);
      const minDist = a.collisionRadius + b.collisionRadius;
      if (d >= minDist) continue;
      collided.add(a.instanceId);
      collided.add(b.instanceId);

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

  return collided;
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
 * walk cycle. steerToward() feeds this function the pure seek direction, not
 * the separation-blended velocity, specifically so a crowd of jostling
 * neighbors can't drag facing along with it (see that function's own
 * comment) — this buffer only has to absorb the seek signal's own small
 * jitter, not real, potentially large swings from nearby Pokémon shoving
 * past each other. */
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
