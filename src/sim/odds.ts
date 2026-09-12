import type { MoveDefinition, PokemonInstance, SimState } from './types';
import type { MoveLookup } from './matchSetup';
import { getStageMultiplier } from './statCalc';
import { getEffectiveness } from './typeChart';
import { STAB_MULT } from './constants';
import { BOSS_CONFIG } from './bossConfig';

/** Live "who's likely to win" odds for the room predictions panel — a cheap,
 * deterministic heuristic over the current sim state rather than a Monte
 * Carlo replay, so game-server can recompute it on every faint from inside
 * its broadcast loop without stalling the tick loop. Pure: no sim mutation,
 * no randomness, shareable with the client if it ever wants to preview. */

/** Exponent applied to each option's strength before normalising — spreads a
 * 2:1 strength gap to roughly 75/25 without pinning the underdog at 0. */
export const ODDS_EXPONENT = 1.6;
/** Floor for a fighter's offence — a status-only moveset, or one every
 * living enemy is immune to, still has *some* chance (Struggle, chip damage). */
export const ODDS_MIN_OFFENSE = 1;

export interface OddsOption {
  id: string;
  instanceIds: readonly string[];
}

/** Expected damage of one move against one defender: damage.ts's formula
 * without the crit/random/burn rolls, weighted by accuracy. 0 for a status
 * move or a type the defender is immune to. */
export function estimateMoveDamage(attacker: PokemonInstance, move: MoveDefinition, defender: PokemonInstance): number {
  if (move.category === 'status' || move.power === null) return 0;
  const atkKey = move.category === 'physical' ? 'atk' : 'spa';
  const defKey = move.category === 'physical' ? 'def' : 'spd';
  const atk = attacker.computedStats[atkKey] * getStageMultiplier(atkKey, attacker.statStages[atkKey]);
  const def = Math.max(1, defender.computedStats[defKey] * getStageMultiplier(defKey, defender.statStages[defKey]));
  const effectiveness = move.typeless ? 1 : getEffectiveness(move.type, defender.types);
  if (effectiveness === 0) return 0;
  const stab = !move.typeless && attacker.types.includes(move.type) ? STAB_MULT : 1;
  const bossBonus = attacker.isBoss ? BOSS_CONFIG.damageMultiplier : 1;
  const accuracy = move.accuracy === null ? 1 : move.accuracy / 100;
  const base = Math.floor(Math.floor((2 * attacker.level) / 5 + 2) * move.power * (atk / def)) / 50 + 2;
  return base * stab * effectiveness * bossBonus * accuracy;
}

/** One fighter's standing against a set of enemies: geometric mean of its
 * offence (its best expected hit, averaged over every enemy) and its bulk
 * (remaining HP × mean defence). Fainted fighters have no HP, hence 0. */
export function fighterStrength(self: PokemonInstance, enemies: readonly PokemonInstance[], moveLookup: MoveLookup): number {
  const def = self.computedStats.def * getStageMultiplier('def', self.statStages.def);
  const spd = self.computedStats.spd * getStageMultiplier('spd', self.statStages.spd);
  const bulk = (Math.max(0, self.currentHp) * (def + spd)) / 2;

  let offense = 0;
  if (enemies.length > 0) {
    let total = 0;
    for (const enemy of enemies) {
      let best = 0;
      for (const slot of self.moves) {
        if (slot.ppRemaining <= 0) continue;
        const move = moveLookup(slot.moveId);
        if (!move) continue;
        best = Math.max(best, estimateMoveDamage(self, move, enemy));
      }
      total += best;
    }
    offense = total / enemies.length;
  }
  return Math.sqrt(Math.max(offense, ODDS_MIN_OFFENSE) * bulk);
}

/** Win probability per option (0–1, summing to 1 while anyone is alive). An
 * option's strength is the sum of its living members' strengths against
 * every living non-member; a lone survivor therefore lands on exactly 1 and
 * a fully fainted option on exactly 0, so settlement needs no special case. */
export function computeWinOdds(state: Readonly<SimState>, moveLookup: MoveLookup, options: readonly OddsOption[]): Record<string, number> {
  const living = new Set(state.livingOrder);
  const weights = options.map((option) => {
    const members = new Set(option.instanceIds);
    const enemies = state.livingOrder.filter((id) => !members.has(id)).map((id) => state.pokemon[id]);
    let strength = 0;
    for (const id of option.instanceIds) {
      if (!living.has(id)) continue;
      strength += fighterStrength(state.pokemon[id], enemies, moveLookup);
    }
    return Math.pow(strength, ODDS_EXPONENT);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const odds: Record<string, number> = {};
  options.forEach((option, index) => {
    odds[option.id] = total > 0 ? weights[index] / total : 0;
  });
  return odds;
}
