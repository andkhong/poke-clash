import type { PokemonInstance, StatusCondition, SimEvent } from './types';
import type { Rng } from './rng';
import { rngChance, rngIntInclusive } from './rng';
import {
  BURN_CHIP_FRACTION,
  FREEZE_THAW_CHANCE,
  PARALYSIS_FULL_PARA_CHANCE,
  POISON_CHIP_FRACTION,
  SLEEP_MAX_TURNS,
  SLEEP_MIN_TURNS,
  STATUS_TICK_INTERVAL_MS,
} from './constants';

/** A Pokémon can only carry one major status condition at a time (standard rule). */
export function canApplyStatus(target: PokemonInstance): boolean {
  return target.status === null;
}

export function applyStatus(
  target: PokemonInstance,
  status: StatusCondition,
  rng: Rng
): void {
  if (!canApplyStatus(target)) return;
  target.status = status;
  if (status === 'sleep') {
    target.statusTurnsRemaining = rngIntInclusive(rng, SLEEP_MIN_TURNS, SLEEP_MAX_TURNS);
  } else if (status === 'freeze') {
    target.statusTurnsRemaining = undefined; // freeze clears via thaw-chance roll, not a countdown
  }
}

export interface ActionGateResult {
  /** false = this Pokémon cannot act (move or attack) this attempt. */
  canAct: boolean;
  /** Status that changed as a result of this gate check (e.g. thawed, woke up), if any. */
  clearedStatus?: StatusCondition;
}

/**
 * Called once per action-cooldown cadence (not the fast movement tick) for a
 * status-afflicted Pokémon, immediately before it would otherwise act.
 */
export function gateAction(target: PokemonInstance, rng: Rng): ActionGateResult {
  if (target.status === 'sleep') {
    const remaining = (target.statusTurnsRemaining ?? 1) - 1;
    if (remaining <= 0) {
      target.status = null;
      target.statusTurnsRemaining = undefined;
      return { canAct: true, clearedStatus: 'sleep' };
    }
    target.statusTurnsRemaining = remaining;
    return { canAct: false };
  }

  if (target.status === 'freeze') {
    if (rngChance(rng, FREEZE_THAW_CHANCE)) {
      target.status = null;
      return { canAct: true, clearedStatus: 'freeze' };
    }
    return { canAct: false };
  }

  if (target.status === 'paralysis') {
    if (rngChance(rng, PARALYSIS_FULL_PARA_CHANCE)) {
      return { canAct: false };
    }
    return { canAct: true };
  }

  return { canAct: true };
}

/** A Fire-type move landing on a frozen target thaws it immediately (standard rule). */
export function maybeThawOnFireHit(target: PokemonInstance, moveTypeIsFire: boolean): boolean {
  if (target.status === 'freeze' && moveTypeIsFire) {
    target.status = null;
    return true;
  }
  return false;
}

/**
 * Advance burn/poison's independent slow chip-damage timer. Returns the events
 * produced (0 or 1) so the engine can append them to the shared log. Caller is
 * responsible for actually decrementing currentHp / handling faint.
 */
export function tickStatusDamage(
  target: PokemonInstance,
  dtMs: number,
  nextSeq: () => number,
  atMs: number
): { event: SimEvent | null; damage: number } {
  if (target.status !== 'burn' && target.status !== 'poison') {
    return { event: null, damage: 0 };
  }

  target.statusTickAccumMs += dtMs;
  if (target.statusTickAccumMs < STATUS_TICK_INTERVAL_MS) {
    return { event: null, damage: 0 };
  }
  target.statusTickAccumMs -= STATUS_TICK_INTERVAL_MS;

  const fraction = target.status === 'burn' ? BURN_CHIP_FRACTION : POISON_CHIP_FRACTION;
  const damage = Math.max(1, Math.floor(target.maxHp * fraction));

  return {
    event: {
      seq: nextSeq(),
      atMs,
      type: 'statusTick',
      instanceId: target.instanceId,
      status: target.status,
      amount: damage,
    },
    damage,
  };
}
