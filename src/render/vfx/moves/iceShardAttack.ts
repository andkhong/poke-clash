import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Real cropped art (see public/move-assets/iceShard/README.md) — a broken
 * ice-crystal cluster, replacing the procedural diamond-shard particle.
 * Used as-is (no runtime tint): ice-blue already reads correctly for this
 * family's only two callers (Ice Shard/Icicle Spear and the special ice
 * movepool — see moveAnimations.ts), same convention as poison/water. */
export const ICE_SHARD_TEXTURE_KEY = 'vfx-iceshard-crystal';
export function preloadIceShardVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(ICE_SHARD_TEXTURE_KEY, '/move-assets/iceShard/crystal.png');
}

/** Ice Shard/Icicle Spear-style VFX (see moveAnimations.ts's type rule and
 * overrides) — a spray of small tumbling ice crystals from the attacker
 * toward the target, the ice counterpart to leafAttack.ts's leaf jet and
 * bubbleAttack.ts's bubble jet (same charge-then-spray-then-puff shape).
 * Unlike leaf/bubble (opaque matter or translucent film, both normal-
 * blended), ice crystals catch and throw light, so this reuses flame/
 * thunder's additive glow instead — the same "genuinely glowing" reasoning,
 * just cold rather than hot. Caster stays stationary, same as every other
 * ranged family. */
const CHARGE_DURATION_MS = 120;
const STREAM_DURATION_MS = 240;
const PARTICLES_PER_UPDATE = 2;
/** How far a shard can drift sideways off the attacker-target line, scaled by
 * how far along the jet it is (wider spread further out) — same spread shape
 * as leafAttack.ts's jet, for a sprayed-cone look instead of a razor-straight
 * stream. */
const JET_SPREAD_PX = 16;

export function playIceShardAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const glowColor = lighten(color, 0.75);
  scene.textures.get(ICE_SHARD_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const shardKey = ICE_SHARD_TEXTURE_KEY;

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
          spawnShardParticle(scene, fromX, fromY, toX, toY, perpX, perpY, progress.t, shardKey);
        }
      },
      onComplete: () => {
        playImpactBurst(scene, toX, toY, type);
        playShardBurst(scene, toX, toY, shardKey);
      },
    });
  });
}

/** One shard somewhere behind the jet's current leading edge, with random
 * along-jet position, perpendicular spread, size and spin — same
 * per-particle randomness approach as leafAttack.ts's spawnLeafParticle, so
 * a spray of this one static shape reads as a scatter of tumbling ice
 * fragments rather than a repeating stamp. */
function spawnShardParticle(
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

  const shard = scene.add
    .image(x, y, textureKey)
    .setScale(1.3 + Math.random() * 1.5)
    .setAngle(Phaser.Math.Between(0, 359))
    .setAlpha(0.9 + Math.random() * 0.1)
    .setDepth(500)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: shard,
    alpha: 0,
    angle: shard.angle + Phaser.Math.Between(-150, 150),
    scaleX: shard.scaleX * 0.4,
    scaleY: shard.scaleY * 0.4,
    duration: 200 + Math.random() * 100,
    onComplete: () => shard.destroy(),
  });
}

function playShardBurst(scene: Phaser.Scene, x: number, y: number, shardKey: string): void {
  const emitter = scene.add.particles(x, y, shardKey, {
    speed: { min: 40, max: 130 },
    angle: { min: 0, max: 360 },
    rotate: { min: 0, max: 360 },
    scale: { start: 2.2, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: { min: 220, max: 360 },
    quantity: 10,
    blendMode: 'ADD',
    emitting: false,
  });
  emitter.setDepth(600);
  emitter.explode(10);
  scene.time.delayedCall(450, () => emitter.destroy());
}
