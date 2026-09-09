import Phaser from 'phaser';

/** Shared procedural pixel-art textures for move VFX, generated at runtime the
 * same way sparkle.ts builds its reveal-sparkle texture: a hand-authored ASCII
 * pixel grid drawn once via Graphics.generateTexture with nearest-neighbor
 * filtering, so it reads as genuine pixel art rather than an anti-aliased
 * shape. Each texture is generated once per resolved move-type color and
 * cached by key — many moves share the same family (see moveAnimations.ts)
 * and therefore the same small set of textures, just re-tinted. Real
 * hand-drawn replacements can eventually live in public/move-assets/ without
 * changing how callers reference these — see that directory's README. */
const PIXEL_UNIT = 3;

// Small bright shard/diamond — the trailing particles along a beam's path.
const BEAM_PARTICLE_GRID = ['010', '111', '010'];

// A denser diamond burst than sparkle.ts's twinkle cross — used for the flash
// at the moment of contact (beam impact or a lunge's punch landing).
const IMPACT_BURST_GRID = ['00100', '01210', '12221', '01210', '00100'];

// A small tapered flame lick — tip narrow, base wide, hot '2' core running up
// the middle — used for the flame family's sprayed-jet particles (see
// flameAttack.ts) instead of a smooth beam line.
const FLAME_PARTICLE_GRID = ['00100', '00100', '01110', '11211', '12221', '11111', '01110'];

// A small jagged lightning-bolt shard — a zigzag stroke with a bright '2'
// flash at its sharpest bend — scattered along the thunder family's jagged
// bolt path (see thunderAttack.ts) the same way beam's diamond shard trails
// its straight line.
const THUNDER_PARTICLE_GRID = ['00011', '00110', '01100', '11211', '00110', '01100', '11000'];

// A small pointed leaf — symmetric top-to-bottom (unlike the flame lick's
// asymmetric taper) with a bright '2' vein running down the middle — used for
// the leaf family's sprayed-jet particles (see leafAttack.ts) instead of a
// melee lunge or a smooth beam line.
const LEAF_PARTICLE_GRID = ['00100', '01110', '11211', '11211', '11211', '01110', '00100'];

// A round bubble — a filled circle with a bright '2' glint arc along the top
// (the light-reflection highlight real bubbles show), rather than a pointed
// leaf/flame shape — used for the bubble family's sprayed-jet particles (see
// bubbleAttack.ts), the Bubble/Bubble Beam counterpart to Razor Leaf's leaves.
const BUBBLE_PARTICLE_GRID = ['0011100', '0122210', '1111111', '1111111', '1111111', '0111110', '0011100'];

// A faceted ice crystal — a symmetric diamond that tapers to a point at both
// ends (unlike the leaf's flat-sided taper) with a bright '2' cross-facet
// flash at its widest point — used for the iceShard family's sprayed-jet
// particles (see iceShardAttack.ts), a sharper/more angular look than the
// leaf/bubble shapes to read as broken ice rather than organic matter.
const ICE_SHARD_PARTICLE_GRID = ['00100', '00100', '01110', '12221', '01110', '00100', '00100'];

// A short diagonal streak — a motion-blurred dash rather than a filled shape
// — used for the vortex family's orbiting debris (see vortexAttack.ts)
// circling a spinning Hurricane/wind vortex.
const WIND_PARTICLE_GRID = ['00012', '00120', '01200', '12000', '20000'];

// A lumpy cluster of two-three overlapping rock chunks — an uneven, bumpy
// silhouette (unlike bubble's clean circle) with two separate bright '2'
// facet-flashes, one per bump, echoing a hand-drawn boulder-cluster
// reference — used for the rockBurst family's eruption debris (see
// rockBurstAttack.ts) instead of a smooth beam or melee lunge.
const ROCK_PARTICLE_GRID = ['0011000', '0111100', '1111110', '1121121', '1111110', '0111100', '0011000'];

function buildTexture(scene: Phaser.Scene, key: string, grid: string[], brightColor: number, dimColor: number): void {
  if (scene.textures.exists(key)) return;

  const size = grid.length * PIXEL_UNIT;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  grid.forEach((row, ry) => {
    [...row].forEach((cell, rx) => {
      if (cell === '0') return;
      g.fillStyle(cell === '2' ? brightColor : dimColor, 1);
      g.fillRect(rx * PIXEL_UNIT, ry * PIXEL_UNIT, PIXEL_UNIT, PIXEL_UNIT);
    });
  });
  g.generateTexture(key, size, size);
  g.destroy();
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Darkens a 0xRRGGBB color toward black by `factor` (0-1) — used to derive a
 * dim accent shade from a move's base type color for these two-tone grids. */
function dim(hex: number, factor = 0.45): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Lightens a 0xRRGGBB color toward white by `factor` (0-1) — used for a
 * beam's hot, near-white core so it reads as a bright laser rather than a
 * flat colored line (see beamAttack.ts). */
export function lighten(hex: number, factor = 0.6): number {
  const r = Math.round(((hex >> 16) & 0xff) + (255 - ((hex >> 16) & 0xff)) * factor);
  const g = Math.round(((hex >> 8) & 0xff) + (255 - ((hex >> 8) & 0xff)) * factor);
  const b = Math.round((hex & 0xff) + (255 - (hex & 0xff)) * factor);
  return (r << 16) | (g << 8) | b;
}

export function buildBeamParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-beam-particle-${color.toString(16)}`;
  buildTexture(scene, key, BEAM_PARTICLE_GRID, 0xffffff, color);
  return key;
}

export function buildImpactBurstTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-impact-burst-${color.toString(16)}`;
  buildTexture(scene, key, IMPACT_BURST_GRID, 0xffffff, dim(color));
  return key;
}

/** `color` is the flame's base (edge/body) shade — a hot pale-yellow core is
 * always used for the bright cells regardless of color, since even a
 * differently-tinted flame (e.g. a shiny recolor) should still look "on
 * fire" at its hottest point. */
export function buildFlameParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-flame-particle-${color.toString(16)}`;
  buildTexture(scene, key, FLAME_PARTICLE_GRID, 0xfff2b0, color);
  return key;
}

/** `color` is the bolt's base (edge) shade — the bright cells always use a
 * near-white hot-spark color regardless of color, same reasoning as
 * buildFlameParticleTexture's core. */
export function buildThunderParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-thunder-particle-${color.toString(16)}`;
  buildTexture(scene, key, THUNDER_PARTICLE_GRID, 0xffffee, color);
  return key;
}

/** Unlike flame/thunder's fixed hot-white/hot-ember bright cells, a leaf has
 * no universal "hot" point to fall back on regardless of recolor — so its
 * vein just uses a lightened shade of the same `color` instead. */
export function buildLeafParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-leaf-particle-${color.toString(16)}`;
  buildTexture(scene, key, LEAF_PARTICLE_GRID, lighten(color, 0.55), color);
  return key;
}

/** `color` is the bubble's base (body) shade — the glint is always a fixed
 * near-white highlight regardless of color, same "universal bright point"
 * reasoning as flame/thunder's core (a bubble's light-reflection glint isn't
 * tied to what color the bubble itself is). */
export function buildBubbleParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-bubble-particle-${color.toString(16)}`;
  buildTexture(scene, key, BUBBLE_PARTICLE_GRID, 0xf2fbff, color);
  return key;
}

/** `color` is the shard's base (edge) shade — the facet flash always uses a
 * near-white icy glint regardless of color, same fixed-highlight reasoning as
 * flame/thunder's core. */
export function buildIceShardParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-ice-shard-particle-${color.toString(16)}`;
  buildTexture(scene, key, ICE_SHARD_PARTICLE_GRID, 0xf0ffff, color);
  return key;
}

/** `color` is the streak's base shade — the bright tip always uses a near-
 * white highlight regardless of color, same fixed-highlight reasoning as
 * flame/thunder's core (a gust of wind has no color of its own to begin
 * with, so the debris streak leans on the move's type color throughout,
 * brightening only at the leading tip). */
export function buildWindParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-wind-particle-${color.toString(16)}`;
  buildTexture(scene, key, WIND_PARTICLE_GRID, 0xffffff, color);
  return key;
}

/** Unlike flame/thunder/bubble/ice's fixed highlight, a rock's facet-shine
 * is just a lighter shade of the same stone — no universal "hot"/"glint"
 * point independent of what color the rock itself is — same reasoning as
 * buildLeafParticleTexture's vein. */
export function buildRockParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-rock-particle-${color.toString(16)}`;
  buildTexture(scene, key, ROCK_PARTICLE_GRID, lighten(color, 0.45), color);
  return key;
}
