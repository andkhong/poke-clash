import type { MoveDefinition, PokemonInstance } from './types';
import type { Rng } from './rng';
import { rngChance } from './rng';
import { getEffectiveStat, getStageMultiplier } from './statCalc';
import { getEffectiveness } from './typeChart';
import {
  BURN_PHYSICAL_DAMAGE_MULT,
  CRIT_CHANCE,
  CRIT_DAMAGE_MULT,
  HIGH_CRIT_CHANCE,
  STAB_MULT,
} from './constants';
import { BOSS_CONFIG } from './bossConfig';

export interface DamageResult {
  damage: number;
  hit: boolean;
  crit: boolean;
  effectiveness: number;
}

/** Gen 6+ accuracy check: move accuracy (0-100, or null = never misses) modified by stages. */
export function rollAccuracy(
  rng: Rng,
  move: MoveDefinition,
  attacker: PokemonInstance,
  defender: PokemonInstance
): boolean {
  if (move.accuracy === null) return true;
  const accStage = attacker.statStages.accuracy - defender.statStages.evasion;
  const chance = (move.accuracy / 100) * getStageMultiplier('accuracy', accStage);
  return rngChance(rng, Math.max(0, Math.min(1, chance)));
}

export function resolveDamage(
  rng: Rng,
  move: MoveDefinition,
  attacker: PokemonInstance,
  defender: PokemonInstance
): DamageResult {
  const hit = rollAccuracy(rng, move, attacker, defender);
  if (!hit || move.category === 'status' || move.power === null) {
    return { damage: 0, hit, crit: false, effectiveness: 1 };
  }

  const critChance = move.highCrit ? HIGH_CRIT_CHANCE : CRIT_CHANCE;
  const crit = rngChance(rng, critChance);

  const atkKey = move.category === 'physical' ? 'atk' : 'spa';
  const defKey = move.category === 'physical' ? 'def' : 'spd';

  // Crits ignore the attacker's negative offensive stages and the defender's positive
  // defensive stages (standard behavior) — approximate by just using unstaged stat
  // when it would otherwise be unfavorable to the attacker.
  const atkStage = attacker.statStages[atkKey];
  const defStage = defender.statStages[defKey];
  const effectiveAtkStage = crit ? Math.max(0, atkStage) : atkStage;
  const effectiveDefStage = crit ? Math.min(0, defStage) : defStage;

  const atk =
    attacker.computedStats[atkKey] * getStageMultiplier(atkKey, effectiveAtkStage);
  const def = Math.max(
    1,
    defender.computedStats[defKey] * getStageMultiplier(defKey, effectiveDefStage)
  );

  const effectiveness = move.typeless ? 1 : getEffectiveness(move.type, defender.types);
  if (effectiveness === 0) {
    return { damage: 0, hit, crit: false, effectiveness };
  }

  const level = attacker.level;
  const base = Math.floor(Math.floor((2 * level) / 5 + 2) * move.power * (atk / def)) / 50 + 2;

  const randomFactor = 0.85 + rng() * 0.15; // [0.85, 1.00]
  const stab = !move.typeless && attacker.types.includes(move.type) ? STAB_MULT : 1;
  const burnPenalty =
    move.category === 'physical' && attacker.status === 'burn' ? BURN_PHYSICAL_DAMAGE_MULT : 1;

  const bossDamageBonus = attacker.isBoss ? BOSS_CONFIG.damageMultiplier : 1;

  const multiplier =
    (crit ? CRIT_DAMAGE_MULT : 1) * randomFactor * stab * effectiveness * burnPenalty * bossDamageBonus;

  const damage = Math.max(1, Math.floor(base * multiplier));
  return { damage, hit, crit, effectiveness };
}

// getEffectiveStat is re-exported here so damage.ts consumers don't need a second
// import from statCalc for the common "what's this Pokémon's current X" question.
export { getEffectiveStat };
