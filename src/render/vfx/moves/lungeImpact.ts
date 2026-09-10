import Phaser from 'phaser';

/** Real cropped art (see public/move-assets/lunge/README.md) — a 3-frame
 * gloved-fist punch sequence, played as a quick flip-book at the moment of
 * contact for every lunge-family move (Tackle, Fire Punch, Close Combat,
 * ...), layered on top of impactBurst.ts's existing sparkle rather than
 * replacing it. Used as-is (no runtime tint) — a punch-impact flash reads
 * fine regardless of the attacking move's type, same reasoning as
 * poison/water's "pre-colored, used as-is" convention.
 */
const PUNCH_TEXTURE_KEYS = ['vfx-lunge-punch-1', 'vfx-lunge-punch-2', 'vfx-lunge-punch-3'] as const;

export function preloadLungeVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(PUNCH_TEXTURE_KEYS[0], '/move-assets/lunge/punch1.png');
  scene.load.image(PUNCH_TEXTURE_KEYS[1], '/move-assets/lunge/punch2.png');
  scene.load.image(PUNCH_TEXTURE_KEYS[2], '/move-assets/lunge/punch3.png');
}

const FRAME_DURATION_MS = 55;
const PUNCH_SCALE = 1.8;
const FADE_DURATION_MS = 100;

export function playLungePunchFlash(scene: Phaser.Scene, x: number, y: number): void {
  for (const key of PUNCH_TEXTURE_KEYS) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);

  const sprite = scene.add.image(x, y, PUNCH_TEXTURE_KEYS[0]).setScale(PUNCH_SCALE).setDepth(501).setAlpha(0.95);

  let frame = 0;
  const advance = (): void => {
    if (!scene.sys.isActive()) return; // scene torn down mid-sequence (e.g. match restarted)
    frame += 1;
    if (frame >= PUNCH_TEXTURE_KEYS.length) {
      scene.tweens.add({
        targets: sprite,
        alpha: 0,
        scale: PUNCH_SCALE * 1.2,
        duration: FADE_DURATION_MS,
        onComplete: () => sprite.destroy(),
      });
      return;
    }
    sprite.setTexture(PUNCH_TEXTURE_KEYS[frame]);
    scene.time.delayedCall(FRAME_DURATION_MS, advance);
  };
  scene.time.delayedCall(FRAME_DURATION_MS, advance);
}
