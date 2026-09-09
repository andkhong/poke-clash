import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { buildLeafParticleTexture, lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Razor Leaf-style VFX (see moveAnimations.ts's override) — a spray of small
 * tumbling leaves from the attacker toward the target, the grass counterpart
 * to flameAttack.ts's flame jet (same charge-then-spray-then-puff shape).
 * Two deliberate departures from a straight copy of that file: leaves tumble
 * with a full random spin rather than flame's small flicker-tilt, and
 * neither the leaves nor their puff use an additive blend — flame/thunder are
 * glowing light and read right with ADD's blown-out highlights, but a leaf is
 * ordinary opaque matter, so normal blending is what makes it look like a
 * solid leaf instead of a glowing green light. Caster stays stationary, same
 * as every other ranged family. */
const CHARGE_DURATION_MS = 120;
const STREAM_DURATION_MS = 240;
const PARTICLES_PER_UPDATE = 2;
/** How far a leaf can drift sideways off the attacker-target line, scaled by
 * how far along the jet it is (wider spread further out) — same spread shape
 * as flameAttack.ts's jet, for a sprayed-cone look instead of a razor-straight
 * stream. */
const JET_SPREAD_PX = 16;

export function playLeafAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const glowColor = lighten(color, 0.7);
  const leafKey = buildLeafParticleTexture(scene, color);

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const charge = scene.add
    .circle(fromX, fromY, 10, glowColor, 0.95)
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
          spawnLeafParticle(scene, fromX, fromY, toX, toY, perpX, perpY, progress.t, leafKey);
        }
      },
      onComplete: () => {
        playImpactBurst(scene, toX, toY, type);
        playLeafPuff(scene, toX, toY, leafKey);
      },
    });
  });
}

/** One leaf somewhere behind the jet's current leading edge, with random
 * along-jet position, perpendicular spread, size and spin — same per-particle
 * randomness approach as flameAttack.ts's spawnFlameParticle, so a spray of
 * this one static shape reads as a scatter of tumbling leaves rather than a
 * repeating stamp. */
function spawnLeafParticle(
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

  const leaf = scene.add
    .image(x, y, textureKey)
    .setScale(1.4 + Math.random() * 1.6)
    .setAngle(Phaser.Math.Between(0, 359))
    .setAlpha(0.9 + Math.random() * 0.1)
    .setDepth(500);
  scene.tweens.add({
    targets: leaf,
    alpha: 0,
    angle: leaf.angle + Phaser.Math.Between(-140, 140),
    scaleX: leaf.scaleX * 0.4,
    scaleY: leaf.scaleY * 0.4,
    duration: 220 + Math.random() * 100,
    onComplete: () => leaf.destroy(),
  });
}

function playLeafPuff(scene: Phaser.Scene, x: number, y: number, leafKey: string): void {
  const emitter = scene.add.particles(x, y, leafKey, {
    speed: { min: 40, max: 130 },
    angle: { min: 0, max: 360 },
    rotate: { min: 0, max: 360 },
    scale: { start: 2, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: { min: 220, max: 360 },
    quantity: 10,
    emitting: false,
  });
  emitter.setDepth(600);
  emitter.explode(10);
  scene.time.delayedCall(450, () => emitter.destroy());
}
