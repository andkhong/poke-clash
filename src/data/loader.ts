import pokemonData from './generated/pokemon.json';
import movesData from './generated/moves.json';
import pmdSpriteIndexData from './generated/pmdSpriteIndex.json';
import type { GeneratedSpecies, PmdSpriteIndex } from './types';
import type { MoveDefinition, PokemonTypeName } from '../sim/types';
import type { MoveLookup, SpeciesData } from '../sim/matchSetup';
import { COLLISION_RADIUS_FACTOR, PMD_MAX_SPRITE_SIZE, PMD_MIN_SPRITE_SIZE, PMD_NATIVE_SCALE } from '../sim/constants';

const SPECIES_LIST = pokemonData as GeneratedSpecies[];
const MOVES_BY_ID = new Map<number, MoveDefinition>(
  Object.entries(movesData as Record<string, MoveDefinition>).map(([id, def]) => [Number(id), def])
);
const PMD_SPRITE_INDEX = pmdSpriteIndexData as PmdSpriteIndex;

/** Only species with a real downloaded PMD sprite (see
 * data-pipeline/fetch-pmd-sprites.ts) are selectable for a match — the ~6%
 * without one (PMDCollab has no art yet, or their asset server currently
 * 500s for that id) are excluded from roster selection entirely, rather than
 * letting a match silently include the older hotlink-art fallback. */
export function hasPmdSprite(speciesId: number): boolean {
  return PMD_SPRITE_INDEX[String(speciesId)] !== undefined;
}

/** Same on-screen-size math PokemonSprite.ts uses to scale the sprite,
 * turned into a collision radius (see COLLISION_RADIUS_FACTOR) so a
 * Pokémon's hitbox actually matches what's drawn. Species without PMD data
 * fall back to a mid-roster-typical size — selectable species always have
 * one (see hasPmdSprite/pickRandomSpeciesIds), so this only matters if
 * buildSpeciesDataForLevel is ever called directly with an unfiltered id. */
function computeCollisionRadius(speciesId: number): number {
  const idle = PMD_SPRITE_INDEX[String(speciesId)]?.actions.Idle;
  const nativeSize = idle ? Math.max(idle.frameWidth, idle.frameHeight) : 48;
  const onScreenSize = Math.min(PMD_MAX_SPRITE_SIZE, Math.max(PMD_MIN_SPRITE_SIZE, nativeSize * PMD_NATIVE_SCALE));
  return onScreenSize * COLLISION_RADIUS_FACTOR;
}

const SPECIES_BY_ID = new Map<number, GeneratedSpecies>(SPECIES_LIST.map((s) => [s.id, s]));

export const moveLookup: MoveLookup = (moveId) => MOVES_BY_ID.get(moveId);

export function getMoveDefinition(moveId: number): MoveDefinition | undefined {
  return MOVES_BY_ID.get(moveId);
}

export interface SpeciesSummary {
  id: number;
  name: string;
  types: PokemonTypeName[];
}

export function listAllSpecies(): SpeciesSummary[] {
  return SPECIES_LIST.map((s) => ({ id: s.id, name: s.name, types: s.types }));
}

/**
 * Derives the runtime movePool for one species at a chosen level: level-up
 * moves learnable at/under that level, unioned with TM-learnable moves (TMs
 * have no level gate). The generated dataset stores learnsets level-agnostic
 * on purpose so this can be recomputed per match without re-running the
 * pipeline. Guarantees a real, in-game-legal candidate pool — not a synthetic
 * one — even though it may occasionally be under 4 moves for a handful of
 * species whose real movesets are genuinely that sparse (e.g. Ditto, Smeargle).
 */
export function buildSpeciesDataForLevel(speciesId: number, level: number): SpeciesData | undefined {
  const raw = SPECIES_BY_ID.get(speciesId);
  if (!raw) return undefined;

  const eligibleLevelUp = raw.levelUpMoves.filter((m) => m.level <= level).map((m) => m.moveId);
  const movePool = [...new Set([...eligibleLevelUp, ...raw.tmMoves])];

  return {
    id: raw.id,
    name: raw.name,
    types: raw.types,
    baseStats: raw.baseStats,
    movePool,
    collisionRadius: computeCollisionRadius(raw.id),
  };
}

export function buildSpeciesMapForLevel(speciesIds: readonly number[], level: number): Record<number, SpeciesData> {
  const result: Record<number, SpeciesData> = {};
  for (const id of speciesIds) {
    const data = buildSpeciesDataForLevel(id, level);
    if (data) result[id] = data;
  }
  return result;
}

export function pickRandomSpeciesIds(count: number, exclude: readonly number[] = []): number[] {
  const excludeSet = new Set(exclude);
  const pool = SPECIES_LIST.map((s) => s.id).filter((id) => !excludeSet.has(id) && hasPmdSprite(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
