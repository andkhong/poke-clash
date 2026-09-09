import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Real cropped art (see public/move-assets/bubble/README.md) — a glossy
 * round bubble, replacing the procedural bubble particle. Used as-is (no
 * runtime tint): this family's only two callers (Bubble/Bubble Beam — see
 * moveAnimations.ts) are always water-blue, same convention as poison/water. */
export const BUBBLE_TEXTURE_KEY = 'vfx-bubble-orb';
export function preloadBubbleVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(BUBBLE_TEXTURE_KEY, '/move-assets/bubble/orb.png');
}

/** Bubble/Bubble Beam-style VFX (see moveAnimations.ts's overrides) — a spray
 * of small round bubbles from the attacker toward the target, the water
 * counterpart to leafAttack.ts's leaf jet (same charge-then-spray-then-puff
 * shape). Bubbles are translucent, not glowing or solid, so they use a
 * partly-transparent normal blend instead of flame/thunder's additive glow or
 * leaf's fully-opaque fill, and only a gentle wobble-tilt rather than a
 * leaf's full tumble, since a floating bubble doesn't spin end over end.
 * Caster stays stationary, same as every other ranged family. */
const CHARGE_DURATION_MS = 120;
const STREAM_DURATION_MS = 240;
const PARTICLES_PER_UPDATE = 2;
/** How far a bubble can drift sideways off the attacker-target line, scaled
 * by how far along the jet it is (wider spread further out) — same spread
 * shape as leafAttack.ts's jet, for a sprayed-cone look instead of a
 * razor-straight stream. */
const JET_SPREAD_PX = 16;
const BUBBLE_ALPHA = 0.8;

export function playBubbleAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const glowColor = lighten(color, 0.7);
  scene.textures.get(BUBBLE_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const bubbleKey = BUBBLE_TEXTURE_KEY;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const charge = scene.add
    .circle(fromX, fromY, 10, glowColor, 0.7)
    .setDepth(499)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: charge,
    radius: 26,
    alpha: 0,
    duration: CHARGE_DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => charge.destroy(),
  });

  scene.time.delayedCall(CHARGE_DURATION_MS, () => {
    if (!scene.sys.isActive()) return; // scene torn down mid-delay (e.g. match restarted)
    const progress = { t: 0 };
    scene.tweens.add({
      targets: progress,
      t: 1,
      duration: STREAM_DURATION_MS,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        for (let i = 0; i < PARTICLES_PER_UPDATE; i++) {
          spawnBubbleParticle(scene, fromX, fromY, toX, toY, perpX, perpY, progress.t, bubbleKey);
        }
      },
      onComplete: () => {
        playImpactBurst(scene, toX, toY, type);
        playBubblePop(scene, toX, toY, bubbleKey);
      },
    });
  });
}

/** One bubble somewhere behind the jet's current leading edge, with random
 * along-jet position, perpendicular spread, size and a small wobble-tilt —
 * same per-particle randomness approach as leafAttack.ts's spawnLeafParticle,
 * so a spray of this one static shape reads as a scatter of floating bubbles
 * rather than a repeating stamp. */
function spawnBubbleParticle(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  perpX: number,
  perpY: number,
  headT: number,
  textureKey: string
): void {
  const alongT = Math.max(0, headT - Math.random() * 0.35);
  const spread = (Math.random() - 0.5) * JET_SPREAD_PX * (0.3 + alongT);
  const x = Phaser.Math.Linear(fromX, toX, alongT) + perpX * spread;
  const y = Phaser.Math.Linear(fromY, toY, alongT) + perpY * spread;

  const bubble = scene.add
    .image(x, y, textureKey)
    .setScale(1.2 + Math.random() * 1.4)
    .setAngle(Phaser.Math.Between(-20, 20))
    .setAlpha(BUBBLE_ALPHA)
    .setDepth(500);
  scene.tweens.add({
    targets: bubble,
    alpha: 0,
    angle: bubble.angle + Phaser.Math.Between(-30, 30),
    scaleX: bubble.scaleX * 1.15,
    scaleY: bubble.scaleY * 1.15,
    duration: 220 + Math.random() * 100,
    onComplete: () => bubble.destroy(),
  });
}

function playBubblePop(scene: Phaser.Scene, x: number, y: number, bubbleKey: string): void {
  const emitter = scene.add.particles(x, y, bubbleKey, {
    speed: { min: 40, max: 130 },
    angle: { min: 0, max: 360 },
    scale: { start: 1.8, end: 0 },
    alpha: { start: BUBBLE_ALPHA, end: 0 },
    lifespan: { min: 220, max: 360 },
    quantity: 10,
    emitting: false,
  });
  emitter.setDepth(600);
  emitter.explode(10);
  scene.time.delayedCall(450, () => emitter.destroy());
}
