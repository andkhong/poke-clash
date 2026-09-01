import type { StageKey, StatBlock, StatKey } from './types';
import { PARALYSIS_SPEED_MULT } from './constants';

// Every Pokémon is compared at "fair raw potential": IV=31 (perfect) for all six
// stats, EV=0, neutral nature. This was the agreed default for "real stats,
// balanced" — no per-Pokémon IV/EV/nature customization in v1.
const IV = 31;
const EV = 0;

/** Standard Gen 3+ stat formula. */
export function computeStats(base: StatBlock, level: number): StatBlock {
  const hp =
    base.hp === 1
      ? 1 // Shedinja-style fixed 1 HP is a stretch-goal edge case; guard anyway.
      : Math.floor(((2 * base.hp + IV + Math.floor(EV / 4)) * level) / 100) + level + 10;

  const other = (baseStat: number): number =>
    Math.floor(((2 * baseStat + IV + Math.floor(EV / 4)) * level) / 100) + 5;

  return {
    hp,
    atk: other(base.atk),
    def: other(base.def),
    spa: other(base.spa),
    spd: other(base.spd),
    spe: other(base.spe),
  };
}

/** The five core battle stats (excludes HP, which is never staged) use one curve... */
function stageMultiplierCore(stage: number): number {
  const n = Math.max(-6, Math.min(6, stage));
  return n >= 0 ? (2 + n) / 2 : 2 / (2 - n);
}

/** ...while accuracy/evasion use a *different* curve. Mixing these up is the classic bug. */
function stageMultiplierAccuracy(stage: number): number {
  const n = Math.max(-6, Math.min(6, stage));
  return n >= 0 ? (3 + n) / 3 : 3 / (3 - n);
}

export function getStageMultiplier(key: StageKey, stage: number): number {
  return key === 'accuracy' || key === 'evasion'
    ? stageMultiplierAccuracy(stage)
    : stageMultiplierCore(stage);
}

/** Effective (post-stage, post-status) value for one of the five core stats. */
export function getEffectiveStat(
  computed: StatBlock,
  statStages: Record<StageKey, number>,
  key: Exclude<StatKey, 'hp'>,
  status: 'paralysis' | null
): number {
  let value = computed[key] * getStageMultiplier(key, statStages[key]);
  if (key === 'spe' && status === 'paralysis') value *= PARALYSIS_SPEED_MULT;
  return Math.max(1, Math.floor(value));
}

export function getEffectiveAccuracyStage(statStages: Record<StageKey, number>): number {
  return statStages.accuracy;
}

export function getEffectiveEvasionStage(statStages: Record<StageKey, number>): number {
  return statStages.evasion;
}

export function createNeutralStages(): Record<StageKey, number> {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
}
