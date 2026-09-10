import type { ApiMove } from './pokeApiTypes';
import type {
  MoveCategory,
  MoveDefinition,
  MoveEffect,
  MoveTargeting,
  PokemonTypeName,
  StageKey,
  StatusCondition,
} from '../src/sim/types';

// Bucketing follows the plan: PokeAPI's move.meta already returns a structured
// ailment/stat_changes object (not just free text), so most of this is
// programmatic. Only "which target/ailment/stat values do we understand" needs
// a short hardcoded list — not a full manual mapping of every move.

const SUPPORTED_STATUSES = new Set<string>(['sleep', 'paralysis', 'burn', 'poison', 'freeze']);

const STAT_NAME_MAP: Record<string, StageKey> = {
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
  accuracy: 'accuracy',
  evasion: 'evasion',
};

/** Meta categories whose *primary* effect is a stat change (not a damage move's secondary chance). */
const PRIMARY_STAT_CATEGORIES = new Set(['net-good-stats']);
/** Meta categories where a stat change is a secondary chance riding on a damaging move. */
const SECONDARY_STAT_CATEGORIES = new Set(['damage+lower', 'damage+raise', 'swagger']);
/** Moves whose user faints on use (MoveDefinition.userFaints). PokeAPI's
 * move.meta has no field for this — it's only in the prose effect text, and
 * missing even there for newer moves (Misty Explosion) — so a short list by
 * API name. The status ones (Memento, Healing Wish, Lunar Dance) and Final
 * Gambit (no listed power) are excluded from the dataset anyway; they're
 * here so the flag is right if they ever come in. */
const USER_FAINTS_MOVES = new Set(['self-destruct', 'explosion', 'misty-explosion', 'final-gambit', 'memento', 'healing-wish', 'lunar-dance']);

function mapTargeting(targetName: string): MoveTargeting | null {
  switch (targetName) {
    case 'user':
      return 'self';
    case 'selected-pokemon':
    case 'random-opponent':
      return 'enemy';
    case 'all-other-pokemon':
    case 'all-opponents':
      return 'all-enemies-in-radius';
    default:
      // entire-field / user-and-allies / users-field / opponents-field / specific-move / etc. —
      // no team or field-effect concept in this engine, so these are out of scope.
      return null;
  }
}

function toDisplayName(apiName: string): string {
  return apiName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function classifyEffect(api: ApiMove, targeting: MoveTargeting): MoveEffect | undefined {
  const meta = api.meta;
  if (!meta) return undefined;

  const effectTarget: 'self' | 'enemy' = targeting === 'self' ? 'self' : 'enemy';

  if (SUPPORTED_STATUSES.has(meta.ailment.name)) {
    const isPrimaryEffect = meta.category.name === 'ailment';
    const chance = isPrimaryEffect ? 100 : meta.ailment_chance > 0 ? meta.ailment_chance : undefined;
    if (isPrimaryEffect || chance !== undefined) {
      return {
        kind: 'statusInflict',
        status: meta.ailment.name as StatusCondition,
        target: effectTarget,
        chance,
      };
    }
  }

  if (
    api.stat_changes.length > 0 &&
    (PRIMARY_STAT_CATEGORIES.has(meta.category.name) || SECONDARY_STAT_CATEGORIES.has(meta.category.name))
  ) {
    const statChanges: Partial<Record<StageKey, number>> = {};
    for (const sc of api.stat_changes) {
      const key = STAT_NAME_MAP[sc.stat.name];
      if (key) statChanges[key] = sc.change;
    }
    if (Object.keys(statChanges).length > 0) {
      const isPrimaryEffect = PRIMARY_STAT_CATEGORIES.has(meta.category.name);
      const chance = isPrimaryEffect ? 100 : meta.stat_chance > 0 ? meta.stat_chance : undefined;
      if (isPrimaryEffect || chance !== undefined) {
        return { kind: 'statStage', target: effectTarget, statChanges, chance };
      }
    }
  }

  return undefined;
}

/**
 * Returns null for moves we deliberately don't support: field effects/hazards,
 * weather, OHKO, confusion-only, switch-forcing, ally/field targeting, or any
 * pure-utility move with no damage and no effect we model. Multi-turn
 * charge/semi-invulnerable moves (Solar Beam, Fly, Dig, ...) are intentionally
 * NOT excluded — we simplify them to instant single-tick moves rather than
 * modeling the charge turn, per the "simplify reasonably" scope decision.
 */
export function classifyMove(api: ApiMove): MoveDefinition | null {
  const targeting = mapTargeting(api.target.name);
  if (!targeting) return null;

  const category = api.damage_class.name as MoveCategory;
  const isDamaging = api.power !== null && category !== 'status';
  const effect = classifyEffect(api, targeting);

  if (!isDamaging && !effect) return null;

  return {
    id: api.id,
    name: toDisplayName(api.name),
    type: api.type.name as PokemonTypeName,
    category,
    power: isDamaging ? api.power : null,
    accuracy: api.accuracy,
    pp: api.pp,
    priority: api.priority,
    targeting,
    effect,
    highCrit: (api.meta?.crit_rate ?? 0) > 0 || undefined,
    userFaints: USER_FAINTS_MOVES.has(api.name) || undefined,
  };
}
