import Phaser from 'phaser';

// The example videos show a small burst of white sparkle/twinkle particles
// around a Pokémon the moment it appears — this reproduces that with a
// procedurally-generated 4-point star texture (no sparkle asset was sourced,
// so it's drawn once via Graphics.generateTexture and cached) fired through
// Phaser's particle emitter.
const SPARKLE_TEXTURE_KEY = 'vfx-sparkle-star';
const SPARKLE_SIZE = 10;

function ensureSparkleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SPARKLE_TEXTURE_KEY)) return;

  const s = SPARKLE_SIZE;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.beginPath();
  g.moveTo(s * 0.5, 0);
  g.lineTo(s * 0.62, s * 0.38);
  g.lineTo(s, s * 0.5);
  g.lineTo(s * 0.62, s * 0.62);
  g.lineTo(s * 0.5, s);
  g.lineTo(s * 0.38, s * 0.62);
  g.lineTo(0, s * 0.5);
  g.lineTo(s * 0.38, s * 0.38);
  g.closePath();
  g.fillPath();
  g.generateTexture(SPARKLE_TEXTURE_KEY, s, s);
  g.destroy();
}

/** One-shot sparkle burst around a point — call the moment a Pokémon is revealed. */
export function playSparkleReveal(scene: Phaser.Scene, x: number, y: number): void {
  ensureSparkleTexture(scene);

  const emitter = scene.add.particles(x, y, SPARKLE_TEXTURE_KEY, {
    speed: { min: 25, max: 65 },
    angle: { min: 0, max: 360 },
    scale: { start: 1.3, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: { min: 350, max: 550 },
    quantity: 12,
    blendMode: 'ADD',
    emitting: false,
  });
  emitter.setDepth(600);
  emitter.explode(12);

  scene.time.delayedCall(700, () => emitter.destroy());
}
