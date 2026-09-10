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
  /** Root-relative URLs of a locally mirrored copy of this species' `tier`
   * art (public/fallback-sprites/, committed — see
   * data-pipeline/fetch-fallback-sprites.ts). Only species without PMD
   * sprites get one; the resolver prefers it over the hotlinked original,
   * so production never depends on Showdown or GitHub being up. */
  local?: {
    front: string;
    back: string;
  };
}

export type SpriteIndex = Record<string, SpriteIndexEntry>;

// Shape of public/pmd-sprite-index.json (see data-pipeline/fetch-pmd-sprites.ts
// and pmdSpriteIndexFiles.ts — fetched by the arena at match start, not
// bundled; src/data/generated/pmdSpriteIds.json is its list of keys).
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
// One entry per move id that has a clip at public/move-sounds/<moveId>.mp3
// (committed, shipped with the app build like public/cries/) — moves with
// no entry (mostly generations 8+, which the mirrored SFX pack doesn't
// cover) simply play silently. The clip's URL is derived from the id, so
// the entry only records provenance.
export interface MoveSoundIndexEntry {
  /** "<folder>/<file>" the clip was transcoded from in the gitignored sound/
   * mirror, e.g. "GEN 7 SFX - Attack Moves - SUMO, USUM/Flamethrower.mp3". */
  source: string;
}

export type MoveSoundIndex = Record<string, MoveSoundIndexEntry>;

// Shape of src/data/generated/moveAnimations.json (see
// data-pipeline/build-move-animations.ts). The bundled index of the
// converted Gen 9 Move Animation Project animations: one entry per move id
// with a file at public/move-anims/moves/<moveId>.json, plus the pack's
// status-condition animations under `common`. Carries just enough for the
// arena to fetch an animation's sheet in parallel with its JSON and pick
// the attacker's pose; the animation data itself (src/data/moveAnimationFormat.ts)
// is fetched on demand, never bundled.
export interface MoveAnimationIndexEntry {
  /** The pack's name for the animation, e.g. "Move:TACKLE" — provenance only. */
  anim: string;
  /** Sheet slug under public/move-anims/sheets/, null when the animation
   * only moves/hides the battlers and draws nothing of its own. */
  sheet: string | null;
  frames: number;
  /** True when the animation itself dashes the attacker into the target
   * (Tackle, Body Slam, ...), so the attacker should play its melee-swing
   * pose rather than the ranged one. */
  melee: boolean;
  /** True for a screen-wide effect: most of the animation's cells are
   * anchored to the whole battle screen rather than to a battler (Surf,
   * Earthquake, Growl, ...), or it draws nothing but a full-screen
   * background/foreground overlay the conversion doesn't ship (Heat Wave,
   * Psychic, ...). Those don't translate to a free-roaming top-down arena,
   * so the arena plays its own family VFX for them instead (see
   * src/render/vfx/moveAnimations.ts) and skips the pack animation. */
  screen: boolean;
}

export interface MoveAnimationIndex {
  moves: Record<string, MoveAnimationIndexEntry>;
  common: Record<string, MoveAnimationIndexEntry>;
}
