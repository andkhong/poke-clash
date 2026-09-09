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

// A small jagged lightning-bolt shard — a zigzag stroke with a bright '2'
// flash at its sharpest bend — scattered along the thunder family's jagged
// bolt path (see thunderAttack.ts) the same way beam's diamond shard trails
// its straight line.
const THUNDER_PARTICLE_GRID = ['00011', '00110', '01100', '11211', '00110', '01100', '11000'];

// A short diagonal streak — a motion-blurred dash rather than a filled shape
// — used for the vortex family's orbiting debris (see vortexAttack.ts)
// circling a spinning Hurricane/wind vortex.
const WIND_PARTICLE_GRID = ['00012', '00120', '01200', '12000', '20000'];

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

/** `color` is the bolt's base (edge) shade — the bright cells always use a
 * near-white hot-spark color regardless of color, same "universal bright
 * point" reasoning as buildImpactBurstTexture's core. */
export function buildThunderParticleTexture(scene: Phaser.Scene, color: number): string {
  const key = `vfx-thunder-particle-${color.toString(16)}`;
  buildTexture(scene, key, THUNDER_PARTICLE_GRID, 0xffffee, color);
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

