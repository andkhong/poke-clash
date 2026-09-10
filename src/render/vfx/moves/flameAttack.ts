import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { playImpactBurst } from './impactBurst';

/** Real cropped art (see public/move-assets/flame/README.md) — a single
 * flame-burst frame, replacing the procedural flame-lick particle. Used
 * as-is (no runtime tint): fire's own orange/red already reads correctly
 * for this family's other caller too (dragon breath, reusing the same jet —
 * see moveAnimations.ts), same convention as poison/water. */
export const FLAME_TEXTURE_KEY = 'vfx-flame-burst';
export function preloadFlameVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(FLAME_TEXTURE_KEY, '/move-assets/flame/burst.png');
}

/** Flamethrower/Fire Blast/Heat Wave-style VFX (see moveAnimations.ts's
 * fire-type routing) — a jet of small flickering flame sprites sprayed from
 * the attacker toward the target, rather than playBeamAttack's smooth
 * two-stroke laser line. Fire is the one element where "beam" doesn't match
 * the real thing being depicted — a flamethrower sprays fire, it doesn't
 * fire a laser — so it gets its own particle-stream treatment. Caster stays
 * stationary, same as the beam family. */
const CHARGE_DURATION_MS = 120;
const STREAM_DURATION_MS = 240;
const PARTICLES_PER_UPDATE = 2;
/** How far a flame particle can drift sideways off the attacker-target line,
 * scaled by how far along the jet it is (wider spread further from the
 * mouth), for a sprayed-cone look instead of a razor-straight stream. */
const JET_SPREAD_PX = 16;
const FLAME_CORE_COLOR = 0xfff2b0;

export function playFlameAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  scene.textures.get(FLAME_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const flameKey = FLAME_TEXTURE_KEY;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const charge = scene.add
    .circle(fromX, fromY, 10, FLAME_CORE_COLOR, 0.95)
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
          spawnFlameParticle(scene, fromX, fromY, toX, toY, perpX, perpY, progress.t, flameKey);
        }
      },
      onComplete: () => {
        playImpactBurst(scene, toX, toY, type);
        playFlamePuff(scene, toX, toY, flameKey);
      },
    });
  });
}

/** One flame particle somewhere behind the jet's current leading edge, with
 * random along-jet position, perpendicular spread, size and tilt — the
 * per-particle randomness is what makes a dense stream of a single static
 * shape read as a flickering flame rather than a repeating stamp. */
function spawnFlameParticle(
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

  const flame = scene.add
    .image(x, y, textureKey)
    .setScale(1.4 + Math.random() * 1.6)
    .setAngle(Phaser.Math.Between(-25, 25))
    .setAlpha(0.85 + Math.random() * 0.15)
    .setDepth(500)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: flame,
    alpha: 0,
    scaleX: flame.scaleX * 0.4,
    scaleY: flame.scaleY * 0.4,
    duration: 200 + Math.random() * 100,
    onComplete: () => flame.destroy(),
  });
}

function playFlamePuff(scene: Phaser.Scene, x: number, y: number, flameKey: string): void {
  const emitter = scene.add.particles(x, y, flameKey, {
    speed: { min: 40, max: 130 },
    angle: { min: 0, max: 360 },
    scale: { start: 2.4, end: 0 },
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
