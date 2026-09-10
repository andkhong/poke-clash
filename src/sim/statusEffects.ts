import type { PokemonInstance, StatusCondition, SimEvent } from './types';
import type { Rng } from './rng';
import { rngChance, rngIntInclusive } from './rng';
import {
  BURN_CHIP_FRACTION,
  FREEZE_MAX_TURNS,
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

/** Sleep and freeze both take the Pokémon out of the fight entirely (see
 * ai.ts's 'incapacitated' state) — the only two statuses that do. */
export function isIncapacitatingStatus(status: StatusCondition | null): boolean {
  return status === 'sleep' || status === 'freeze';
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
    // Freeze normally clears via its per-turn thaw roll (see gateAction) —
    // this is only the hard ceiling on how long a bad streak can last.
    target.statusTurnsRemaining = FREEZE_MAX_TURNS;
  }
}

export interface ActionGateResult {
  /** false = this Pokémon cannot act (move or attack) this attempt. */
  canAct: boolean;
  /** Status that changed as a result of this gate check (e.g. thawed, woke up), if any. */
  clearedStatus?: StatusCondition;
}

/**
 * Called once per "turn" (not the fast movement tick) for a status-afflicted
 * Pokémon: for a paralyzed one, immediately before it would otherwise act
 * (engine.ts's executeMove); for a sleeping/frozen one — which never reaches
 * that path, since it can't act at all — on the fixed
 * STATUS_TURN_INTERVAL_MS cadence engine.ts's tickIncapacitated gives it.
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
    const remaining = (target.statusTurnsRemaining ?? FREEZE_MAX_TURNS) - 1;
    if (remaining <= 0 || rngChance(rng, FREEZE_THAW_CHANCE)) {
      target.status = null;
      target.statusTurnsRemaining = undefined;
      return { canAct: true, clearedStatus: 'freeze' };
    }
    target.statusTurnsRemaining = remaining;
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
    target.statusTurnsRemaining = undefined;
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
