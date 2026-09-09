import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { buildWindParticleTexture, lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Hurricane-style VFX (see moveAnimations.ts's override) — a spinning
 * vortex that spins up AT the target and bursts outward, the wind
 * counterpart to waveAttack.ts's water wave: another "field effect
 * appearing at the target" rather than a projectile from the attacker (see
 * that file's own comment for the backstory — Surf and Hurricane were both
 * flagged for this treatment when neither had it yet). `fromX`/`fromY` are
 * accepted only for signature consistency with every other family (see
 * ArenaScene.ts's uniform call shape) and otherwise unused — the whole
 * effect plays out around the target regardless of where the attacker
 * actually is, same as the wave.
 *
 * Drawn as concentric partial-circle arcs (a single Graphics object cleared
 * and redrawn every tick, same technique as waveAttack.ts/beamAttack.ts)
 * spinning at different speeds and directions per ring, plus a handful of
 * wind-streak particles orbiting the rim, so it reads as a genuine
 * spinning vortex rather than a static ring. Angles are derived directly
 * from total elapsed time (not accumulated per-frame) so the spin rate
 * stays exact regardless of frame timing.
 */
const SPIN_UP_MS = 260;
const HOLD_MS = 120;
const RECEDE_MS = 220;
const TOTAL_MS = SPIN_UP_MS + HOLD_MS + RECEDE_MS;

/** Real cropped art (see public/move-assets/vortex/README.md) — a twisted
 * grey tornado column, layered in as a genuine spinning-funnel body behind
 * the procedural concentric rings/orbiters below rather than replacing them
 * (this family's core "field effect at the target" shape still needs the
 * rings' independent per-ring spin, which a single static sprite can't do
 * on its own). Used as-is (no runtime tint), same as water's pillar — grey
 * reads as "wind" regardless of the move's actual type. */
export const VORTEX_TWISTER_TEXTURE_KEY = 'vfx-vortex-twister';
export function preloadVortexVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(VORTEX_TWISTER_TEXTURE_KEY, '/move-assets/vortex/twister.png');
}
/** twister.png is native 32x64 — scaled so its full height roughly matches
 * the outermost ring's diameter (RINGS[2].radius * 2 = 96) at full curl. */
const TWISTER_SCALE = 1.5;
const TWISTER_SPIN_DEG_PER_SEC = 540;

interface Ring {
  radius: number;
  /** Signed — sign flips per ring so adjacent rings spin opposite ways. */
  speedRadPerSec: number;
  startAngle: number;
}
const RINGS: readonly Ring[] = [
  { radius: 16, speedRadPerSec: 7, startAngle: 0 },
  { radius: 32, speedRadPerSec: -5, startAngle: Math.PI / 3 },
  { radius: 48, speedRadPerSec: 3.6, startAngle: Math.PI },
];
const ORBIT_RING_INDEX = 1; // which RINGS entry the wind-streak particles ride
const ORBIT_PARTICLE_COUNT = 6;

function curlAt(tMs: number): number {
  if (tMs <= SPIN_UP_MS) return Phaser.Math.Easing.Cubic.Out(tMs / SPIN_UP_MS);
  if (tMs <= SPIN_UP_MS + HOLD_MS) return 1;
  const t = Math.min(1, (tMs - SPIN_UP_MS - HOLD_MS) / RECEDE_MS);
  return 1 - Phaser.Math.Easing.Cubic.In(t);
}

export function playVortexAttack(
  scene: Phaser.Scene,
  _fromX: number,
  _fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const coreColor = lighten(color, 0.6);
  const windKey = buildWindParticleTexture(scene, color);

  scene.textures.get(VORTEX_TWISTER_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const twister = scene.add
    .image(toX, toY, VORTEX_TWISTER_TEXTURE_KEY)
    .setDepth(499)
    .setAlpha(0);

  const rings = scene.add.graphics().setDepth(499);
  const orbiters = Array.from({ length: ORBIT_PARTICLE_COUNT }, () =>
    scene.add.image(toX, toY, windKey).setDepth(500).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0)
  );

  const draw = (tMs: number): void => {
    const curl = curlAt(tMs);
    twister.setScale(curl * TWISTER_SCALE).setAlpha(curl * 0.85).setAngle((tMs / 1000) * TWISTER_SPIN_DEG_PER_SEC);
    rings.clear();
    if (curl > 0.02) {
      rings.lineStyle(3, coreColor, 0.6 * curl);
      for (const ring of RINGS) {
        const r = ring.radius * curl;
        const angle = ring.startAngle + ring.speedRadPerSec * (tMs / 1000);
        rings.beginPath();
        rings.arc(toX, toY, r, angle, angle + Math.PI * 1.5);
        rings.strokePath();
      }
    }

    const orbitRing = RINGS[ORBIT_RING_INDEX];
    const orbitRadius = orbitRing.radius * curl;
    const orbitAngle = orbitRing.startAngle + orbitRing.speedRadPerSec * (tMs / 1000);
    orbiters.forEach((img, i) => {
      const angle = orbitAngle + (i / orbiters.length) * Math.PI * 2;
      img.setPosition(toX + Math.cos(angle) * orbitRadius, toY + Math.sin(angle) * orbitRadius);
      img.setAngle(Phaser.Math.RadToDeg(angle));
      img.setAlpha(curl * 0.9);
    });
  };

  draw(0);

  const clock = { tMs: 0 };
  scene.tweens.add({
    targets: clock,
    tMs: TOTAL_MS,
    duration: TOTAL_MS,
    onUpdate: () => draw(clock.tMs),
    onComplete: () => {
      rings.destroy();
      twister.destroy();
      orbiters.forEach((img) => img.destroy());
    },
  });

  scene.time.delayedCall(SPIN_UP_MS, () => {
    if (!scene.sys.isActive()) return; // scene torn down mid-delay (e.g. match restarted)
    playImpactBurst(scene, toX, toY, type);
  });
}
