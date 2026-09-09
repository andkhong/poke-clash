import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { buildRockParticleTexture, lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Earthquake/Bulldoze/Earth Power-style VFX (see moveAnimations.ts's type
 * rule) — the ground itself erupts into flying rock chunks AT the target,
 * rather than anything traveling from the attacker. The earth counterpart to
 * waveAttack.ts's water wave and vortexAttack.ts's wind vortex: the same
 * "field effect appearing at the target" family, now filled in for ground's
 * whole special movepool plus every spread ground move (see
 * moveAnimations.ts for why melee ground moves like Bone Club stay on the
 * plain 'lunge' default instead — those are genuine punches/kicks, not the
 * ground itself erupting). `fromX`/`fromY` are accepted only for signature
 * consistency with every other family (see ArenaScene.ts's uniform call
 * shape) and otherwise unused.
 *
 * A brief ground-crack flash marks the eruption point, then a burst of rock
 * chunks (varied scale, tumbling) launches upward in a narrow cone and falls
 * back under gravity (Phaser's particle emitter `gravityY`) instead of
 * radiating outward and fading in place like impactBurst.ts's flat sparkle —
 * debris genuinely arcs and drops, reading as solid rock rather than light.
 */
const CRACK_FLASH_MS = 90;
const BURST_DELAY_MS = 80;

export function playRockBurstAttack(
  scene: Phaser.Scene,
  _fromX: number,
  _fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const rockKey = buildRockParticleTexture(scene, color);

  const crack = scene.add.ellipse(toX, toY, 14, 5, lighten(color, 0.3), 0.7).setDepth(498);
  scene.tweens.add({
    targets: crack,
    scaleX: 6,
    scaleY: 3,
    alpha: 0,
    duration: CRACK_FLASH_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => crack.destroy(),
  });

  scene.time.delayedCall(BURST_DELAY_MS, () => {
    if (!scene.sys.isActive()) return; // scene torn down mid-delay (e.g. match restarted)
    playImpactBurst(scene, toX, toY, type);

    const emitter = scene.add.particles(toX, toY, rockKey, {
      speed: { min: 90, max: 220 },
      angle: { min: 230, max: 310 }, // a narrow upward cone, not a full radial burst
      gravityY: 700,
      rotate: { min: 0, max: 360 },
      scale: { start: 2.6, end: 1.1 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 380, max: 520 },
      quantity: 12,
      emitting: false,
    });
    emitter.setDepth(500);
    emitter.explode(12);
    scene.time.delayedCall(600, () => emitter.destroy());
  });
}
