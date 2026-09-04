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

// Shape of src/data/generated/pmdSpriteIndex.json (see data-pipeline/fetch-pmd-sprites.ts).
// One entry per species with usable PMDCollab/SpriteCollab coverage (at least
// Idle+Walk) — species without an entry fall back to the hotlink tier above.
// The raw PNGs live outside git in pmd-sprite-mirror/, served locally by
// sprite-server/; this index carries everything needed to build Phaser
// spritesheets/animations from them without ever parsing AnimData.xml at runtime.
export interface PmdAnimEntry {
  frameWidth: number;
  frameHeight: number;
  /** 8 = one row per compass direction (see FACING_TO_ROW in PokemonSprite.ts); 1 = a single direction-agnostic pose. */
  directions: 1 | 8;
  /** Per-frame duration in ms, converted from AnimData.xml's 1/60s tick units. */
  durationsMs: number[];
  hasShadow: boolean;
}

export interface PmdSpriteIndexEntry {
  /** Zero-padded 4-digit species folder name under pmd-sprite-mirror/, e.g. "0025". */
  dir: string;
  /** Keyed by PMD action name (Idle/Walk/Attack/Hurt/Sleep/Faint — see CORE_ACTIONS). */
  actions: Record<string, PmdAnimEntry>;
  generatedAt: string;
}

export type PmdSpriteIndex = Record<string, PmdSpriteIndexEntry>;
