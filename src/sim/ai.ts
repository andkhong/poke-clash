import type { MoveDefinition, PokemonInstance, SimState } from './types';
import type { Rng } from './rng';
import { rngPick } from './rng';
import { distance } from './movement';
import {
  AGGRO_RADIUS,
  AGGRO_RADIUS_AGGRESSIVE,
  ENGAGE_RANGE,
  ENGAGE_RANGE_AGGRESSIVE,
  isAggressivePhase,
  isBeforeCombatStart,
  LEASH_MULTIPLIER,
  LEASH_MULTIPLIER_AGGRESSIVE,
  RETARGET_INTERVAL_MS,
  RETARGET_INTERVAL_MS_AGGRESSIVE,
} from './constants';
import { STRUGGLE_MOVE_ID } from './struggle';

export function findNearestLivingEnemy(
  self: PokemonInstance,
  state: SimState,
  positions: ReadonlyMap<string, { x: number; y: number }>
): PokemonInstance | null {
  let nearest: PokemonInstance | null = null;
  let nearestDist = Infinity;
  const selfPos = positions.get(self.instanceId) ?? self.position;
  for (const id of state.livingOrder) {
    if (id === self.instanceId) continue;
    const other = state.pokemon[id];
    const d = distance(selfPos, positions.get(id) ?? other.position);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = other;
    }
  }
  return nearest;
}

/**
 * Decides aiState + targetInstanceId for one Pokémon this tick. Reads positions
 * from the tick-start snapshot, not live state, so targeting doesn't depend on
 * which Pokémon happens to be processed first in this tick's loop.
 */
export function updateTargeting(
  self: PokemonInstance,
  state: SimState,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  nowMs: number
): void {
  if (self.status === 'sleep' || self.status === 'freeze') {
    self.aiState = 'incapacitated';
    return;
  }

  // A brief, deliberate cold-open: nobody targets, chases, or attacks for
  // the first few seconds of battle — everyone just wanders — before real
  // combat is allowed to start.
  if (isBeforeCombatStart(nowMs, state.introDurationMs)) {
    self.aiState = 'wander';
    return;
  }

  // From AGGRESSION_TRIGGER_MS (45s) on, every Pokémon hunts more
  // relentlessly — bigger notice radius, longer leash before disengaging,
  // faster re-evaluation of a better target — which is what actually pushes
  // stalled matches toward a real resolution before the 90s hard cutoff.
  const aggressive = isAggressivePhase(nowMs);
  const aggroRadius = aggressive ? AGGRO_RADIUS_AGGRESSIVE : AGGRO_RADIUS;
  const engageRange = aggressive ? ENGAGE_RANGE_AGGRESSIVE : ENGAGE_RANGE;
  const leashMultiplier = aggressive ? LEASH_MULTIPLIER_AGGRESSIVE : LEASH_MULTIPLIER;
  const retargetIntervalMs = aggressive ? RETARGET_INTERVAL_MS_AGGRESSIVE : RETARGET_INTERVAL_MS;

  const current = self.targetInstanceId ? state.pokemon[self.targetInstanceId] : undefined;
  const currentAlive = !!current && state.livingOrder.includes(current.instanceId);
  const selfPos = positions.get(self.instanceId) ?? self.position;

  let shouldRetarget = !currentAlive;
  if (currentAlive && current) {
    const d = distance(selfPos, positions.get(current.instanceId) ?? current.position);
    if (d > aggroRadius * leashMultiplier) shouldRetarget = true;
    if (nowMs - self.lastRetargetMs > retargetIntervalMs) shouldRetarget = true;
  }

  if (shouldRetarget) {
    const nearest = findNearestLivingEnemy(self, state, positions);
    if (nearest) {
      const d = distance(selfPos, positions.get(nearest.instanceId) ?? nearest.position);
      self.targetInstanceId = d <= aggroRadius ? nearest.instanceId : currentAlive ? self.targetInstanceId : null;
    } else if (!currentAlive) {
      self.targetInstanceId = null;
    }
    self.lastRetargetMs = nowMs;
  }

  const target = self.targetInstanceId ? state.pokemon[self.targetInstanceId] : undefined;
  if (!target) {
    self.aiState = 'wander';
    return;
  }
  const d = distance(selfPos, positions.get(target.instanceId) ?? target.position);
  self.aiState = d <= engageRange ? 'attack' : 'chase';
}

/** Being hit by someone you're not already engaged with pulls their aggro onto the attacker. */
export function retaliate(defender: PokemonInstance, attackerId: string, nowMs: number): void {
  if (defender.aiState === 'wander' || !defender.targetInstanceId) {
    defender.targetInstanceId = attackerId;
    defender.lastRetargetMs = nowMs;
  }
}

/** Uniform-random among moves with PP remaining; Struggle if all four are exhausted. */
export function chooseMove(self: PokemonInstance, rng: Rng): number {
  const usable = self.moves.filter((m) => m.ppRemaining > 0);
  if (usable.length === 0) return STRUGGLE_MOVE_ID;
  return rngPick(rng, usable).moveId;
}

/** Opportunistic self-buffing while chasing a spotted target, before it's in engage range (off the attack cooldown gate). */
export function findSelfBuffMove(
  self: PokemonInstance,
  moves: (id: number) => MoveDefinition | undefined
): MoveDefinition | undefined {
  for (const slot of self.moves) {
    if (slot.ppRemaining <= 0) continue;
    const def = moves(slot.moveId);
    if (def?.effect?.kind === 'statStage' && def.effect.target === 'self') return def;
  }
  return undefined;
}
