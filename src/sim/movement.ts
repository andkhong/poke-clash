import type { ArenaBounds, FacingDirection, PokemonInstance, Vec2 } from './types';
import type { Rng } from './rng';
import { rngInt } from './rng';
import {
  ARENA_PADDING,
  ARRIVAL_SLOWDOWN_RADIUS,
  CHASE_SPEED,
  SEPARATION_RADIUS,
  SEPARATION_STRENGTH,
  WANDER_SPEED,
} from './constants';

/** Lightweight neighbor view used for separation — deliberately not a full
 * PokemonInstance so callers can pass a tick-start position snapshot instead of
 * live (mid-tick-mutated) positions, keeping per-tick movement order-independent. */
export interface NeighborPosition {
  instanceId: string;
  position: Vec2;
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
  positions: ReadonlyMap<string, Vec2>
): NeighborPosition[] {
  return ids.map((id) => ({ instanceId: id, position: positions.get(id)! }));
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
    if (d > 0 && d < SEPARATION_RADIUS) {
      const push = (SEPARATION_RADIUS - d) / SEPARATION_RADIUS;
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

/** Dominant axis wins; ties keep the previous facing to avoid jitter. */
export function velocityToFacing(v: Vec2, previous: FacingDirection): FacingDirection {
  if (Math.abs(v.x) < 1e-3 && Math.abs(v.y) < 1e-3) return previous;
  if (Math.abs(v.x) > Math.abs(v.y)) {
    return v.x > 0 ? 'E' : 'W';
  }
  return v.y > 0 ? 'S' : 'N';
}

export const WANDER_MOVE_SPEED = WANDER_SPEED;
export const CHASE_MOVE_SPEED = CHASE_SPEED;
