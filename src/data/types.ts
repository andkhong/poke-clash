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
  /** Decimeters, from PokeAPI — see loader.ts's computeCollisionRadius. */
  heightDm: number;
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
  /** Present only when PMDCollab has real shiny recolor art for this species
   * (see data-pipeline/fetch-pmd-shiny-sprites.ts) — a genuinely different,
   * per-species color palette, not a uniform tint. `actions` here mirrors the
   * same shape as the normal tier but independently measured from the shiny
   * sheets (same layout/timing is expected since shiny is just a recolor,
   * but never assumed). Absent for species PMDCollab hasn't gotten a shiny
   * recolor for yet — PokemonSprite.ts falls back to a flat tint for those. */
  shiny?: {
    dir: string;
    actions: Record<string, PmdAnimEntry>;
  };
}

export type PmdSpriteIndex = Record<string, PmdSpriteIndexEntry>;

// Shape of src/data/generated/moveSounds.json (see data-pipeline/build-move-sound-index.ts).
// One entry per move id matched to a clip in the locally-mirrored sound/
// directory (gitignored, served by sprite-server/ the same way
// pmd-sprite-mirror/ is) — moves with no match (mostly generations 8+, which
// the mirrored SFX pack doesn't cover) simply have no entry and play silently.
export interface MoveSoundIndexEntry {
  /** Exact folder name under sound/, e.g. "GEN 7 SFX - Attack Moves - SUMO, USUM". */
  folder: string;
  /** Exact filename within that folder, e.g. "Flamethrower.mp3". */
  file: string;
}

export type MoveSoundIndex = Record<string, MoveSoundIndexEntry>;
