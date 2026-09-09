import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

export const POISON_GLOBULE_TEXTURE_KEY = 'vfx-poison-globule';

/** Preloads the poison family's one real hand-drawn asset — a sludge-orb
 * frame lifted from the Gunk Shot charge animation in a ripped PMD:
 * Explorers of Time/Darkness attack-effects sheet (see
 * public/move-assets/poison/README.md for the source). Every other family
 * still draws its particles procedurally at runtime
 * (src/render/vfx/moves/pixelTextures.ts) — this is the first real-art
 * asset the move-assets/README.md's "real hand-drawn replacements" note
 * anticipated, so unlike those it needs an explicit preload here rather
 * than building itself lazily on first use. The source art is already
 * poison-purple and this family is only ever assigned to poison moves (see
 * moveAnimations.ts), so it's used as-is with no runtime tint. */
export function preloadPoisonVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(POISON_GLOBULE_TEXTURE_KEY, '/move-assets/poison/globule.png');
}

/** Sludge/Gunk Shot-style VFX (see moveAnimations.ts's type rule and
 * override) — a spray of small tumbling poison globules from the attacker
 * toward the target, the same charge-then-spray-then-splat shape as
 * leafAttack.ts/bubbleAttack.ts/iceShardAttack.ts. Globules are opaque toxic
 * matter, not light, so — like leaf — this uses normal blending rather than
 * flame/thunder/ice's additive glow. Caster stays stationary, same as every
 * other ranged family. */
const CHARGE_DURATION_MS = 120;
const STREAM_DURATION_MS = 240;
const PARTICLES_PER_UPDATE = 2;
/** How far a globule can drift sideways off the attacker-target line, scaled
 * by how far along the jet it is (wider spread further out) — same spread
 * shape as leafAttack.ts's jet, for a sprayed-cone look instead of a
 * razor-straight stream. */
const JET_SPREAD_PX = 16;

export function playPoisonAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const glowColor = lighten(color, 0.6);

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const charge = scene.add
    .circle(fromX, fromY, 10, glowColor, 0.85)
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
          spawnGlobuleParticle(scene, fromX, fromY, toX, toY, perpX, perpY, progress.t);
        }
      },
      onComplete: () => {
        playImpactBurst(scene, toX, toY, type);
        playGlobuleSplat(scene, toX, toY);
      },
    });
  });
}

/** One globule somewhere behind the jet's current leading edge, with random
 * along-jet position, perpendicular spread, size and spin — same
 * per-particle randomness approach as leafAttack.ts's spawnLeafParticle, so
 * a spray of this one real sprite reads as a scatter of tumbling sludge
 * blobs rather than a repeating stamp. */
function spawnGlobuleParticle(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  perpX: number,
  perpY: number,
  headT: number
): void {
  const alongT = Math.max(0, headT - Math.random() * 0.35);
  const spread = (Math.random() - 0.5) * JET_SPREAD_PX * (0.3 + alongT);
  const x = Phaser.Math.Linear(fromX, toX, alongT) + perpX * spread;
  const y = Phaser.Math.Linear(fromY, toY, alongT) + perpY * spread;

  const globule = scene.add
    .image(x, y, POISON_GLOBULE_TEXTURE_KEY)
    .setScale(1.1 + Math.random() * 1.2)
    .setAngle(Phaser.Math.Between(0, 359))
    .setAlpha(0.95)
    .setDepth(500);
  scene.tweens.add({
    targets: globule,
    alpha: 0,
    angle: globule.angle + Phaser.Math.Between(-120, 120),
    scaleX: globule.scaleX * 0.5,
    scaleY: globule.scaleY * 0.5,
    duration: 220 + Math.random() * 100,
    onComplete: () => globule.destroy(),
  });
}

function playGlobuleSplat(scene: Phaser.Scene, x: number, y: number): void {
  const emitter = scene.add.particles(x, y, POISON_GLOBULE_TEXTURE_KEY, {
    speed: { min: 40, max: 130 },
    angle: { min: 0, max: 360 },
    rotate: { min: 0, max: 360 },
    scale: { start: 1.6, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: { min: 220, max: 360 },
    quantity: 8,
    emitting: false,
  });
  emitter.setDepth(600);
  emitter.explode(8);
  scene.time.delayedCall(450, () => emitter.destroy());
}
