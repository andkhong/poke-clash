import type { PokemonTypeName, StatBlock } from '../sim/types';

// Shape of src/data/generated/pokemon.json, produced by data-pipeline/build-dataset.ts.
// Deliberately level-agnostic: level-up moves carry their learn level, and the
// actual movePool for a match is derived at runtime for the selected level (see
// loader.ts) rather than baked in per-level at build time.
export interface GeneratedSpecies {
  id: number;
  name: string;
  types: PokemonTypeName[];
  baseStats: StatBlock;
  levelUpMoves: { moveId: number; level: number }[];
  tmMoves: number[];
}

// Shape of src/data/generated/moves.json — a Record keyed by move id.
export type GeneratedMoves = Record<string, import('../sim/types').MoveDefinition>;

// Shape of src/data/generated/spriteIndex.json (see data-pipeline/probe-sprites.ts).
export type SpriteTier = 'animated' | 'static-gen5' | 'static-official' | 'unknown';

export interface SpriteIndexEntry {
  /** Showdown slug used for both ani/ and ani-back/ (or the static fallback folder). */
  slug: string;
  tier: SpriteTier;
}

export type SpriteIndex = Record<string, SpriteIndexEntry>;
