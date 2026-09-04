import Phaser from 'phaser';

// The example videos show a small burst of white sparkle/twinkle particles
// around a Pokémon the moment it appears. Drawn as a hand-authored pixel
// grid (not a smooth vector polygon) with nearest-neighbor filtering, so it
// reads as genuine pixel art — consistent with the PMD sprites — rather than
// an anti-aliased shape.
const SPARKLE_TEXTURE_KEY = 'vfx-sparkle-pixel';
const SHINY_SPARKLE_TEXTURE_KEY = 'vfx-sparkle-pixel-shiny';
const PIXEL_UNIT = 2; // px per grid cell

// Classic 4-point pixel twinkle: a bright plus with dim diagonal accents.
// '2' = full-bright cell, '1' = dim cell, '0' = empty.
const SPARKLE_GRID = [
  '00100',
  '01210',
  '22222',
  '01210',
  '00100',
];

function buildSparkleTexture(scene: Phaser.Scene, key: string, brightColor: number, dimColor: number): void {
  if (scene.textures.exists(key)) return;

  const size = SPARKLE_GRID.length * PIXEL_UNIT;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  SPARKLE_GRID.forEach((row, ry) => {
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

/** One-shot sparkle burst around a point — call the moment a Pokémon is
 * revealed. `shiny` swaps the usual white/grey twinkle for a gold one, echoing
 * the shiny recolor tint applied to the sprite itself. */
export function playSparkleReveal(scene: Phaser.Scene, x: number, y: number, shiny = false): void {
  const key = shiny ? SHINY_SPARKLE_TEXTURE_KEY : SPARKLE_TEXTURE_KEY;
  buildSparkleTexture(scene, key, shiny ? 0xfff2a8 : 0xffffff, shiny ? 0xe0a428 : 0xc8d8ff);

  const emitter = scene.add.particles(x, y, key, {
    speed: { min: 25, max: 65 },
    angle: { min: 0, max: 360 },
    scale: { start: 2.2, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: { min: 350, max: 550 },
    quantity: shiny ? 20 : 12,
    blendMode: 'ADD',
    emitting: false,
  });
  emitter.setDepth(600);
  emitter.explode(shiny ? 20 : 12);

  scene.time.delayedCall(700, () => emitter.destroy());
}
