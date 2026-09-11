import type { MoveDefinition, PokemonInstance, SimState, StageKey } from './types';
import type { Rng } from './rng';
import { rngPick, rngWeightedPick } from './rng';
import { distance, WANDER_ARRIVAL_DISTANCE } from './movement';
import {
  AGGRO_RADIUS,
  AGGRO_RADIUS_AGGRESSIVE,
  ENGAGE_RANGE,
  ENGAGE_RANGE_AGGRESSIVE,
  isAggressivePhase,
  isBeforeCombatStart,
  LEASH_MULTIPLIER,
  LEASH_MULTIPLIER_AGGRESSIVE,
  NO_WANDER_AGGRO_RADIUS,
  RETARGET_INTERVAL_MS,
  RETARGET_INTERVAL_MS_AGGRESSIVE,
  SELF_KO_MOVE_HP_FRACTION,
  TICK_MS,
} from './constants';
import { STRUGGLE_MOVE_ID } from './struggle';

/** Floor applied to every candidate's proximity weight in
 * pickWeightedRandomTarget, so one right at the radius boundary still keeps
 * a real (if small) chance instead of being effectively excluded. */
const TARGET_WEIGHT_FLOOR = 1;

/**
 * Every living enemy within `radius` is a candidate, weighted linearly by
 * proximity (closer = more likely, never guaranteed) rather than picking the
 * single nearest. This is what keeps several attackers near one lone target
 * from all locking onto it every reacquire, and lets any one attacker's
 * aggro drift across different targets over the course of a match instead of
 * solely focusing on whoever's mathematically closest.
 */
export function pickWeightedRandomTarget(
  self: PokemonInstance,
  state: SimState,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  radius: number,
  rng: Rng
): PokemonInstance | null {
  const selfPos = positions.get(self.instanceId) ?? self.position;
  const candidates: { enemy: PokemonInstance; dist: number }[] = [];
  for (const id of state.livingOrder) {
    if (id === self.instanceId) continue;
    const other = state.pokemon[id];
    if (other.team === self.team) continue; // allies (Boss Mode's party) are never valid targets
    const d = distance(selfPos, positions.get(id) ?? other.position);
    if (d <= radius) candidates.push({ enemy: other, dist: d });
  }
  if (candidates.length === 0) return null;
  return rngWeightedPick(rng, candidates, (c) => Math.max(TARGET_WEIGHT_FLOOR, radius - c.dist)).enemy;
}

/**
 * Decides aiState + targetInstanceId for one Pokémon this tick, and owns the
 * actionCooldownMs decrement (moved here from engine.ts's tick loop) so it
 * can see the exact tick cooldown crosses from locked to unlocked — see
 * justBecameAvailable below. Reads positions from the tick-start snapshot,
 * not live state, so targeting doesn't depend on which Pokémon happens to be
 * processed first in this tick's loop.
 */
export function updateTargeting(
  self: PokemonInstance,
  state: SimState,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  nowMs: number,
  rng: Rng
): void {
  // Unconditional, same cadence as before this moved here — including while
  // asleep/frozen, so a status-locked Pokémon's cooldown still ticks down in
  // the background exactly like it did when engine.ts decremented it.
  const wasOnCooldown = self.actionCooldownMs > 0;
  if (wasOnCooldown) self.actionCooldownMs = Math.max(0, self.actionCooldownMs - TICK_MS);
  const justBecameAvailable = wasOnCooldown && self.actionCooldownMs <= 0;

  // Same unconditional cadence as actionCooldownMs — see stepMovement's use
  // of this to hold the Pokémon still (regardless of aiState) until it
  // expires.
  if (self.postAttackHoldMs > 0) self.postAttackHoldMs = Math.max(0, self.postAttackHoldMs - TICK_MS);

  if (self.status === 'sleep' || self.status === 'freeze') {
    self.aiState = 'incapacitated';
    return;
  }

  // Custom-battle testing flag (MatchConfig.disableWander, echoed onto
  // SimState) — skips both wander gates below and swaps in
  // NO_WANDER_AGGRO_RADIUS, so a test match locks onto its target
  // immediately and holds its ground between attacks instead of wandering
  // off and back. Never set outside the custom-battle screen.
  const noWander = !!state.disableWander;

  // A brief, deliberate cold-open: nobody targets, chases, or attacks for
  // the first few seconds of battle — everyone just wanders — before real
  // combat is allowed to start.
  if (!noWander && isBeforeCombatStart(nowMs, state.introDurationMs)) {
    self.aiState = 'wander';
    return;
  }

  // Still cooling down from the last attack: normally wander it off instead
  // of standing over (or beelining back toward) whoever it just hit — target
  // bookkeeping is skipped entirely here, the next real decision happens the
  // instant cooldown clears (justBecameAvailable, below). Skipped when
  // noWander so a test match's Pokémon hold their ground next to their
  // target between attacks instead — maybeAct() (engine.ts) still won't
  // actually fire again until actionCooldownMs itself clears regardless of
  // aiState, so this only changes where it stands while waiting, not when it
  // next attacks.
  if (self.actionCooldownMs > 0 && !noWander) {
    self.aiState = 'wander';
    return;
  }

  const selfPos = positions.get(self.instanceId) ?? self.position;

  // A wander leg already under way is walked to its end before this Pokémon
  // looks for a fight again, even once its cooldown has cleared. Cutting
  // legs short the moment the cooldown expired (the old behavior) is what
  // quietly herded every match into the middle of the arena: a walk that
  // stops a third of the way to a random point lands a third of the way
  // from wherever you were toward the arena's average point — the center —
  // and repeated every cycle by everyone, that contracts the whole roster
  // onto it. A leg walked to its end lands on a genuinely random point
  // instead (see pickWanderWaypoint in movement.ts for the pick itself), so
  // the roster stays spread across the arena between exchanges, which also
  // simply reads more naturally: it moves on after a scrap, *then* looks
  // around. A paralyzed Pokémon can't walk its leg at all (stepMovement
  // holds it in place — see engine.ts), so this never applies to it, or it
  // would sit out the rest of the match waiting to arrive somewhere.
  const legInProgress =
    !noWander &&
    self.status !== 'paralysis' &&
    self.wanderWaypoint !== undefined &&
    distance(selfPos, self.wanderWaypoint) >= WANDER_ARRIVAL_DISTANCE;
  if (legInProgress) {
    self.aiState = 'wander';
    return;
  }
  // The leg is over (or there never was one): whatever comes next — a
  // chase, an attack, or a fresh leg from stepMovement if nobody's around —
  // starts from a clean slate, and arriving is itself a reason to take a
  // fresh look around (see shouldRetarget below).
  const legJustEnded = self.wanderWaypoint !== undefined;
  self.wanderWaypoint = undefined;

  // From AGGRESSION_TRIGGER_MS (45s) on, every Pokémon hunts more
  // relentlessly — bigger notice radius, longer leash before disengaging,
  // faster re-evaluation of a better target — which is what actually pushes
  // stalled matches toward a real resolution before the 90s hard cutoff.
  const aggressive = isAggressivePhase(nowMs);
  const aggroRadius = noWander ? NO_WANDER_AGGRO_RADIUS : aggressive ? AGGRO_RADIUS_AGGRESSIVE : AGGRO_RADIUS;
  const engageRange = aggressive ? ENGAGE_RANGE_AGGRESSIVE : ENGAGE_RANGE;
  const leashMultiplier = aggressive ? LEASH_MULTIPLIER_AGGRESSIVE : LEASH_MULTIPLIER;
  const retargetIntervalMs = aggressive ? RETARGET_INTERVAL_MS_AGGRESSIVE : RETARGET_INTERVAL_MS;

  const current = self.targetInstanceId ? state.pokemon[self.targetInstanceId] : undefined;
  const currentAlive = !!current && state.livingOrder.includes(current.instanceId);

  // justBecameAvailable is a one-shot trigger alongside the periodic and
  // distance ones: without it, a fast Pokémon's cooldown (as low as 800ms)
  // can expire well before the periodic retargetIntervalMs timer
  // (2000ms/700ms) ever fires, so it would just keep re-attacking the same
  // still-alive, still-in-leash target every cycle — quietly defeating the
  // whole point of randomized targeting for exactly the Pokémon where it
  // matters most. legJustEnded is its sibling for the wander leg that now
  // usually outlasts the cooldown (see legInProgress above).
  let shouldRetarget = !currentAlive || justBecameAvailable || legJustEnded;
  if (currentAlive && current) {
    const d = distance(selfPos, positions.get(current.instanceId) ?? current.position);
    if (d > aggroRadius * leashMultiplier) shouldRetarget = true;
    if (nowMs - self.lastRetargetMs > retargetIntervalMs) shouldRetarget = true;
  }

  if (shouldRetarget) {
    const picked = pickWeightedRandomTarget(self, state, positions, aggroRadius, rng);
    self.targetInstanceId = picked ? picked.instanceId : currentAlive ? self.targetInstanceId : null;
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

/** Uniform-random among moves with PP remaining; Struggle if all four are
 * exhausted — unless self.forcedMoveId pins an exact move (see that field's
 * own comment), in which case it's always returned instead, even past 0 PP,
 * bypassing both the random pick and the Struggle fallback entirely.
 *
 * A move that takes its user down with it (MoveDefinition.userFaints —
 * Explosion, Self-Destruct) is a last resort: it's left out of the pick
 * unless the user is at or under SELF_KO_MOVE_HP_FRACTION of its max HP, or
 * nothing else has PP left. `moves` resolves the slots' definitions; without
 * it every move is treated as ordinary. */
export function chooseMove(self: PokemonInstance, rng: Rng, moves: (id: number) => MoveDefinition | undefined = () => undefined): number {
  if (self.forcedMoveId !== undefined && self.moves.some((m) => m.moveId === self.forcedMoveId)) {
    return self.forcedMoveId;
  }
  const usable = self.moves.filter((m) => m.ppRemaining > 0);
  if (usable.length === 0) return STRUGGLE_MOVE_ID;
  const desperate = self.currentHp <= self.maxHp * SELF_KO_MOVE_HP_FRACTION;
  const candidates = desperate ? usable : usable.filter((m) => !moves(m.moveId)?.userFaints);
  return rngPick(rng, candidates.length > 0 ? candidates : usable).moveId;
}

/** Opportunistic self-buffing while chasing a spotted target, before it's in
 * engage range (off the attack cooldown gate). A move whose every stage
 * change is already pinned at its cap (+6/-6) is passed over: using it would
 * spend PP and an arena-wide attack slot (see MAX_SIMULTANEOUS_ATTACKS in
 * constants.ts) on nothing, and a Pokémon that had reached +6 Attack kept
 * Swords Dancing on every chase for the rest of the match. */
export function findSelfBuffMove(
  self: PokemonInstance,
  moves: (id: number) => MoveDefinition | undefined
): MoveDefinition | undefined {
  for (const slot of self.moves) {
    if (slot.ppRemaining <= 0) continue;
    const def = moves(slot.moveId);
    if (def?.effect?.kind !== 'statStage' || def.effect.target !== 'self') continue;
    if (canStillShiftStages(self, def.effect.statChanges)) return def;
  }
  return undefined;
}

/** Whether at least one of `statChanges` would actually move one of `self`'s
 * stat stages, each clamped to -6..+6 (see engine.ts's applyMoveEffect). */
function canStillShiftStages(self: PokemonInstance, statChanges: Partial<Record<StageKey, number>> | undefined): boolean {
  if (!statChanges) return false;
  for (const [key, delta] of Object.entries(statChanges) as [StageKey, number][]) {
    const stage = self.statStages[key];
    if ((delta > 0 && stage < 6) || (delta < 0 && stage > -6)) return true;
  }
  return false;
}
